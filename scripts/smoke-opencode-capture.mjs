import { TraceForgePlugin } from "../packages/adapter-opencode/dist/operational-plugin.js";

const sessionID=`traceforge-smoke-${Date.now()}`,messageID=`message-${Date.now()}`;
const hooks=await TraceForgePlugin({directory:process.cwd(),worktree:process.cwd(),project:{},client:{},serverUrl:new URL("http://127.0.0.1"),$:()=>{},experimental_workspace:{register(){}}});
await hooks.event?.({event:{type:"session.created",properties:{info:{id:sessionID}}}});
await hooks["chat.message"]?.({sessionID,agent:"build",model:{providerID:"traceforge-smoke",modelID:"observable-test-model"},messageID},{message:{id:messageID,role:"user",agent:"build",model:{providerID:"traceforge-smoke",modelID:"observable-test-model"},time:{created:Date.now()}},parts:[{id:`part-${Date.now()}`,sessionID,messageID,type:"text",text:"TraceForge live-capture smoke test"}]});
await hooks["tool.execute.before"]?.({tool:"read",sessionID,callID:`call-${Date.now()}`},{args:{filePath:"README.md"}});
await hooks.dispose?.();
console.log(JSON.stringify({sessionID}));
