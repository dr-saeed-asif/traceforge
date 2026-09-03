import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";

interface Context { readonly taskId:string; readonly sessionId:string; readonly runId:string }
interface Model { readonly providerID:string; readonly modelID:string }
interface TextPart { readonly type:string; readonly text?:string; readonly messageID?:string; readonly time?:{readonly end?:number} }
interface Message { readonly id:string; readonly role:string; readonly modelID?:string; readonly providerID?:string; readonly time?:{readonly completed?:number} }

export const TraceForgePlugin:Plugin=async(input)=>{
  const settings=loadSettings();
  const apiUrl=settings.TRACEFORGE_API_URL??"http://127.0.0.1:8080";
  const token=settings.TRACEFORGE_API_TOKEN;
  if(!token){console.warn("[TraceForge] TRACEFORGE_API_TOKEN is unavailable; capture disabled");return{};}
  const contexts=new Map<string,Promise<Context>>();
  const contextFor=(sessionId:string)=>{
    let context=contexts.get(sessionId);
    if(!context){context=post<{context:Context}>(apiUrl,token,"/api/v1/integrations/context",{externalSessionId:sessionId}).then(value=>value.context);contexts.set(sessionId,context);}
    return context;
  };
  const capture=async(sessionId:string,eventType:string,payload:Record<string,unknown>,actor?:{name:string})=>{
    try{const context=await contextFor(sessionId);await post(apiUrl,token,"/api/v1/integrations/events",{...context,eventType,payload,...(actor?{actor}:{})});}
    catch(error){console.warn(`[TraceForge] ${eventType} capture failed`,error);}
  };
  return{
    "chat.message":async(inputValue,outputValue)=>{
      const input=inputValue as unknown as {sessionID:string;agent?:string;model?:Model};
      const output=outputValue as unknown as {message:{id:string;agent?:string;model:Model};parts:readonly TextPart[]};
      const model=input.model??output.message.model,agent=input.agent??output.message.agent??"OpenCode";
      const content=output.parts.filter(part=>part.type==="text").map(part=>part.text??"").join("\n");
      await capture(input.sessionID,"PROMPT_SUBMITTED",{content,agent,model:model.modelID});
      await capture(input.sessionID,"AGENT_STARTED",{agentName:agent},{name:agent});
      await capture(input.sessionID,"MODEL_REQUEST",{model:model.modelID,provider:model.providerID},{name:model.modelID});
    },
    event:async({event})=>{
      const value=event as unknown as {type:string;properties:Record<string,unknown>};
      const sessionId=sessionIdOf(value.properties);
      if(!sessionId)return;
      if(value.type==="session.idle")await capture(sessionId,"AGENT_COMPLETED",{status:"COMPLETED"});
      if(value.type==="session.deleted")await capture(sessionId,"SESSION_COMPLETED",{status:"COMPLETED"});
      if(value.type==="message.part.updated"){
        const part=value.properties.part as TextPart|undefined;
        if(part?.type==="text"&&typeof part.text==="string"&&part.time?.end!==undefined)await capture(sessionId,"MODEL_RESPONSE",{responseText:part.text});
      }
    },
    "tool.execute.after":async(inputValue)=>{
      const value=inputValue as unknown as {tool:string;sessionID:string;args?:Record<string,unknown>};
      if(value.tool==="webfetch"&&typeof value.args?.url==="string")await capture(value.sessionID,"RESOURCE_ACCESSED",{resourceType:"webpage",url:value.args.url});
    }
  };
};

function sessionIdOf(properties:Record<string,unknown>):string|null{
  if(typeof properties.sessionID==="string")return properties.sessionID;
  const info=properties.info as {sessionID?:unknown;id?:unknown}|undefined;
  if(typeof info?.sessionID==="string")return info.sessionID;
  if(typeof info?.id==="string")return info.id;
  const part=properties.part as {sessionID?:unknown}|undefined;
  return typeof part?.sessionID==="string"?part.sessionID:null;
}

function loadSettings():Record<string,string>{
  const rootEnv=resolve(dirname(fileURLToPath(import.meta.url)),"../../../.env");
  const path=process.env.TRACEFORGE_RUNTIME_ENV??rootEnv;
  const values={...process.env} as Record<string,string>;
  if(existsSync(path))for(const line of readFileSync(path,"utf8").split(/\r?\n/u)){const match=/^([^#=\s]+)=(.*)$/u.exec(line);if(match?.[1])values[match[1]]=match[2]??"";}
  return values;
}

async function post<T=unknown>(base:string,token:string,path:string,body:unknown):Promise<T>{
  const response=await fetch(`${base.replace(/\/$/u,"")}${path}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`${path} failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
