import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  const workspace=input.directory||input.worktree;
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
      const gitUser=await getGitIdentity((inputValue as any).directory||(inputValue as any).worktree);
      await capture(input.sessionID,"PROMPT_SUBMITTED",{content,agent,model:model.modelID,gitUser});
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
      const value=inputValue as unknown as {tool:string;sessionID:string;args?:unknown};
      const resources=resourcesForTool(value.tool,value.args,workspace);
      for(const resource of resources)await capture(value.sessionID,"RESOURCE_ACCESSED",resource);
      for(const generated of await generatedCodeFor(resources,value.tool,workspace))await capture(value.sessionID,"GENERATED_CODE_CAPTURED",generated);
    }
  };
};

function resourcesForTool(tool:string,args:unknown,workspace:string):Record<string,unknown>[] {
  if(!isRecord(args))return[];
  const normalizedTool=tool.toLowerCase().replace(/[^a-z0-9]/gu,"");

  if(normalizedTool==="webfetch"){
    const url=firstString(args,["url"]);
    return url?[{resourceType:"webpage",accessType:"read",tool,url}]:[];
  }
  if(normalizedTool==="websearch"){
    const query=firstString(args,["query"]);
    return query?[{resourceType:"web-search",accessType:"search",tool,query}]:[];
  }
  if(normalizedTool==="skill"){
    const name=firstString(args,["name","skill"]);
    return name?[{resourceType:"skill",accessType:"read",tool,name}]:[];
  }

  const directFileAccess:Record<string,"read"|"write">={
    read:"read",readfile:"read",view:"read",viewfile:"read",viewimage:"read",
    write:"write",writefile:"write",edit:"write",editfile:"write",multiedit:"write"
  };
  const accessType=directFileAccess[normalizedTool];
  if(accessType){
    const path=firstString(args,["filePath","filepath","path"]);
    return path?[{resourceType:"file",accessType,tool,path:workspacePath(path,workspace)}]:[];
  }

  if(normalizedTool==="applypatch"||normalizedTool==="patch"){
    const patch=firstString(args,["patchText","patch","input"]);
    return patchPaths(patch).map(path=>({resourceType:"file",accessType:"write",tool,path:workspacePath(path,workspace)}));
  }

  if(normalizedTool==="grep"||normalizedTool==="glob"||normalizedTool==="list"||normalizedTool==="listfiles"){
    const path=firstString(args,["path","directory"])??".";
    const pattern=firstString(args,["pattern","query","include"]);
    return [{resourceType:"directory",accessType:"search",tool,path:workspacePath(path,workspace),...(pattern?{pattern}:{})}];
  }

  return[];
}

async function generatedCodeFor(resources:readonly Record<string,unknown>[],tool:string,workspace:string):Promise<Record<string,unknown>[]> {
  const generated:Record<string,unknown>[]=[];
  for(const resource of resources){
    if(resource.resourceType!=="file"||resource.accessType!=="write"||typeof resource.path!=="string")continue;
    const absolute=isAbsolute(resource.path)?resolve(resource.path):resolve(workspace,resource.path);
    const local=relative(workspace,absolute);
    if(local.startsWith("..")||isAbsolute(local)||isSensitivePath(local))continue;
    try{
      const content=await readFile(absolute);
      if(content.byteLength>1024*1024||content.includes(0))continue;
      const code=new TextDecoder("utf-8",{fatal:true}).decode(content);
      generated.push({path:workspacePath(absolute,workspace),code,operation:tool});
    }catch{
      // Deleted, binary, oversized, and unreadable files are intentionally not captured.
    }
  }
  return generated;
}

function isSensitivePath(path:string):boolean{
  const segments=path.replace(/\\/gu,"/").split("/");
  return segments.some(segment=>segment===".git"||segment==="node_modules"||segment===".env"||segment.startsWith(".env."));
}

async function getGitIdentity(workspace:string):Promise<string>{
  const execSync=require("child_process").execSync;
  let name="NOT_AVAILABLE", email="NOT_AVAILABLE";
  try{
    const projectNameRaw=execSync("git config user.name",{cwd:workspace});
    const projectName=projectNameRaw.toString().trim();
    const projectEmailRaw=execSync("git config user.email",{cwd:workspace});
    const projectEmail=projectEmailRaw.toString().trim();
    if(projectName&&projectName!==""&&projectEmail&&projectEmail!==""){
      name=projectName; email=projectEmail;
    }
  }catch{}
  if(name==="NOT_AVAILABLE"||email==="NOT_AVAILABLE"){
    try{
      const globalNameRaw=execSync("git config --global user.name",{});
      const globalName=globalNameRaw.toString().trim();
      const globalEmailRaw=execSync("git config --global user.email",{});
      const globalEmail=globalEmailRaw.toString().trim();
      if(globalName&&globalName!=="")name=globalName;
      if(globalEmail&&globalEmail!=="")email=globalEmail;
    }catch{}
  }
  return name==="NOT_AVAILABLE"||email==="NOT_AVAILABLE"?"NOT_AVAILABLE":`${name} <${email}>`;
}

function isRecord(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}

function firstString(value:Record<string,unknown>,keys:readonly string[]):string|undefined{
  for(const key of keys){
    const candidate=value[key];
    if(typeof candidate==="string"&&candidate.trim()!=="")return candidate.trim();
  }
  return undefined;
}

function workspacePath(path:string,workspace:string):string{
  const absolute=resolve(workspace,path);
  const local=relative(workspace,absolute);
  const selected=local!==""&&!local.startsWith("..")&&!isAbsolute(local)?local:absolute;
  return selected.replace(/\\/gu,"/")||".";
}

function patchPaths(patch:string|undefined):string[]{
  if(!patch)return[];
  const paths=new Set<string>();
  for(const line of patch.split(/\r?\n/gu)){
    const marker=/^\*\*\* (?:Add|Update|Delete) File: (.+)$/u.exec(line);
    const unified=/^(?:\+\+\+|---) (?:a\/|b\/)?(.+)$/u.exec(line);
    const path=(marker?.[1]??unified?.[1])?.trim();
    if(path&&path!=="/dev/null")paths.add(path);
  }
  return[...paths];
}

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
