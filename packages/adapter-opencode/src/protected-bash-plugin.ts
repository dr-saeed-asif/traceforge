import {createConnection} from 'node:net';
import {tool,type Plugin} from '@opencode-ai/plugin';

/** Opt-in Linux adapter. A trusted launcher must register and finalize the
 * session independently. This plugin cannot create its own capture seal. */
export const ProtectedBashPlugin:Plugin=async()=>{
 const socket=process.env.TRACEFORGE_PROTECTED_DISPATCHER_SOCKET;
 const sessionId=process.env.TRACEFORGE_PROTECTED_SESSION_ID;
 if(process.platform!=='linux'||!socket?.startsWith('/')||!sessionId)throw Error('Protected Bash requires Linux and an independently registered dispatcher session');
 async function execute(command:string,signal:AbortSignal):Promise<string>{
  return new Promise((done,reject)=>{
   const connection=createConnection(socket!),parts:string[]=[];let bytes=0,received=false;
   const cancel=()=>connection.destroy(Error('Tool aborted; supervisor capture must be rejected if incomplete'));
   signal.addEventListener('abort',cancel,{once:true});
   connection.setEncoding('utf8');connection.setTimeout(35000,()=>connection.destroy(Error('Dispatcher timeout')));
   connection.on('connect',()=>connection.write(JSON.stringify({op:'execute',sessionId,argv:['/bin/sh','-c',command]})+'\n'));
   connection.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024){connection.destroy(Error('Dispatcher output budget exceeded'));return;}parts.push(String(chunk));const text=parts.join('');if(text.includes('\n')){
    try{const reply=JSON.parse(text.split('\n')[0]!);if(!reply.ok)throw Error(reply.error??'Protected capture failed');received=true;done(JSON.stringify({exitCode:reply.exitCode,stdout:reply.stdout,stderr:reply.stderr,changedPaths:reply.changedPaths}));connection.end();}catch(e){connection.destroy(e as Error);}
   }});
   connection.on('error',reject);connection.on('close',()=>{signal.removeEventListener('abort',cancel);if(!received)reject(Error('Dispatcher closed without a complete response'));});
  });
 }
 return {
  tool:{bash:tool({description:'Execute shell commands exclusively in the protected Linux dispatcher sandbox. Current directory is /workspace; host files and network are unavailable.',args:{command:tool.schema.string().min(1).max(16000),description:tool.schema.string().optional(),timeout:tool.schema.number().optional()},execute:async(args,context)=>execute(args.command,context.abort)})},
  'tool.execute.before':async(input)=>{if(input.tool!=='bash')throw Error('This experimental protected agent profile permits only dispatcher-mediated bash; other built-in/MCP tools must be disabled.');},
 };
};
export default ProtectedBashPlugin;
