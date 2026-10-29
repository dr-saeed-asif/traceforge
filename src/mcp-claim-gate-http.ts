import {createServer,type Server} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createClaimGateServer,type GateServerOptions} from './mcp-claim-gate.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {DsseEnvelope} from './modules/verification/application/claim-record.js';

/** Stateless Streamable HTTP; bearer access and loopback binding by default.
 * Put authenticated TLS termination in front before exposing beyond this host. */
export function createClaimGateHttpServer(options:GateServerOptions&{token:string}):Server {
 if(options.token.length<32)throw Error('Use at least 32 characters of random bearer credential');
 return createServer(async(req,res)=>{
  const supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${options.token}`);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401,{'www-authenticate':'Bearer'}).end();return;}
  if(req.url!=='/mcp'){res.writeHead(404).end();return;}
  if(req.headers.origin){res.writeHead(403).end();return;}
  if(req.method!=='POST'){res.writeHead(405,{'allow':'POST'}).end();return;}
  const server=createClaimGateServer(options),transport=new StreamableHTTPServerTransport({enableJsonResponse:true});
  try{
   let bytes=0;const parts:Buffer[]=[];
   for await(const part of req){bytes+=part.length;if(bytes>2*1024*1024){res.writeHead(413).end();return;}parts.push(Buffer.from(part));}
   const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
   res.on('close',()=>{void transport.close();void server.close();});
   await server.connect(transport);await transport.handleRequest(req,res,body);
  }catch{if(!res.headersSent)res.writeHead(400).end();}
 });
}

async function main():Promise<void>{
 const base=(process.env.TRACEFORGE_API_URL??'http://127.0.0.1:8080').replace(/\/$/u,''),pin=process.env.TRACEFORGE_RECORD_PUBLIC_KEY_FILE;
 if(!pin)throw Error('Pin TRACEFORGE_RECORD_PUBLIC_KEY_FILE for the network gate');
 const token=process.env.TRACEFORGE_MCP_HTTP_TOKEN??'',port=Number(process.env.TRACEFORGE_MCP_HTTP_PORT??8081);
 if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid TRACEFORGE_MCP_HTTP_PORT');
 const key=readFileSync(pin,'utf8'),server=createClaimGateHttpServer({token,publicKeyPem:async()=>key,fetchRecord:async id=>{
  const response=await fetch(`${base}/api/v1/verification/sessions/${encodeURIComponent(id)}/claim-record`,{headers:{authorization:`Bearer ${process.env.TRACEFORGE_API_TOKEN??''}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Upstream claim record request failed: ${response.status}`);return await response.json() as DsseEnvelope;
 }});
 await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
 process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${port}/mcp`,transport:'Streamable HTTP',authentication:'Bearer',scope:'loopback; trusted local consumer'})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write((error as Error).message+'\n');process.exitCode=1;});
