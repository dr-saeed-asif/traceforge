import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import type { AdapterRunContext, NormalizedAgentEvent } from "@traceforge/adapter-contracts";
import { createTraceForgeOpenCodePlugin } from "./plugin.js";

const adapterVersion="1.18.21";
export const TraceForgePlugin:Plugin=async(input)=>{
  const settings=loadSettings(),apiUrl=settings.TRACEFORGE_API_URL??"http://127.0.0.1:8080",token=settings.TRACEFORGE_API_TOKEN;
  if(!token){console.warn("[TraceForge] TRACEFORGE_API_TOKEN is unavailable; capture disabled");return{};}
  const contexts=new Map<string,Promise<AdapterRunContext|null>>();
  const contextForSession=(externalSessionId:string)=>{
    if(!externalSessionId)return Promise.resolve(null);
    let pending=contexts.get(externalSessionId);
    if(!pending){pending=post<{context:AdapterRunContext}>(apiUrl,token,"/api/v1/integrations/context",{adapter:"opencode",externalSessionId,repository:input.worktree||input.directory,workspace:input.directory,developer:process.env.USERNAME??process.env.USER??"local-developer",agentName:"OpenCode",agentVersion:adapterVersion}).then(value=>value.context);contexts.set(externalSessionId,pending);}
    return pending;
  };
  const plugin=createTraceForgeOpenCodePlugin({adapterConfig:{contextForSession},eventHandler:(event)=>post(apiUrl,token,"/api/v1/integrations/events",bounded({...event,adapter:"opencode",adapterVersion})).then(()=>undefined)});
  return plugin(input);
};

function loadSettings():Record<string,string>{
  const explicit=process.env.TRACEFORGE_RUNTIME_ENV;
  const bundled=resolve(dirname(fileURLToPath(import.meta.url)),"../../../.traceforge/operational/runtime.env");
  const path=explicit??bundled,values:Record<string,string>={...process.env} as Record<string,string>;
  if(existsSync(path))for(const line of readFileSync(path,"utf8").split(/\r?\n/u)){const match=/^([^#=]+)=(.*)$/u.exec(line);if(match)values[match[1]!]=match[2]!;}
  return values;
}
async function post<T=unknown>(base:string,token:string,path:string,body:unknown):Promise<T>{const response=await fetch(`${base.replace(/\/$/u,"")}${path}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`[TraceForge] ${path} failed with HTTP ${response.status}`);return response.json() as Promise<T>;}
function bounded(event:NormalizedAgentEvent&{adapter:string;adapterVersion:string}):unknown{const json=JSON.stringify(event);if(Buffer.byteLength(json)<=60_000)return event;return{...event,payload:{captureTruncated:true,originalBytes:Buffer.byteLength(json),originalSha256:createHash("sha256").update(json).digest("hex")}};}
