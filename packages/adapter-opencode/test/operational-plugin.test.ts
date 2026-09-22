import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceForgePlugin } from "../src/operational-plugin.js";

const originalEnvironment={
  TRACEFORGE_API_TOKEN:process.env.TRACEFORGE_API_TOKEN,
  TRACEFORGE_API_URL:process.env.TRACEFORGE_API_URL,
  TRACEFORGE_RUNTIME_ENV:process.env.TRACEFORGE_RUNTIME_ENV
};
const cleanup:string[]=[];

beforeEach(()=>{
  process.env.TRACEFORGE_API_TOKEN="test-token-with-enough-characters";
  process.env.TRACEFORGE_API_URL="http://127.0.0.1:8080";
  process.env.TRACEFORGE_RUNTIME_ENV=resolve("missing-test-runtime.env");
});

afterEach(async()=>{
  restoreEnvironment("TRACEFORGE_API_TOKEN",originalEnvironment.TRACEFORGE_API_TOKEN);
  restoreEnvironment("TRACEFORGE_API_URL",originalEnvironment.TRACEFORGE_API_URL);
  restoreEnvironment("TRACEFORGE_RUNTIME_ENV",originalEnvironment.TRACEFORGE_RUNTIME_ENV);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map(path=>rm(path,{recursive:true,force:true})));
});

describe("TraceForgePlugin resource capture",()=>{
  it("captures web, file, directory, and patch resources after successful tools",async()=>{
    const requests:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      requests.push(body);
      if("externalSessionId" in body)return new Response(JSON.stringify({context:{taskId:"task-1",sessionId:"session-1",runId:"run-1"}}),{status:200});
      return new Response(JSON.stringify({status:"accepted"}),{status:202});
    }));

    const workspace=resolve("fixture-workspace");
    const hooks=await TraceForgePlugin({directory:workspace,worktree:workspace} as never);
    const after=hooks["tool.execute.after"]!;
    const output={title:"done",output:"",metadata:{}};

    await after({tool:"webfetch",sessionID:"session-1",callID:"call-1",args:{url:"https://example.test/docs"}},output);
    await after({tool:"read",sessionID:"session-1",callID:"call-2",args:{filePath:join(workspace,"src","app.ts")}},output);
    await after({tool:"edit",sessionID:"session-1",callID:"call-3",args:{filePath:join(workspace,"src","app.ts")}},output);
    await after({tool:"grep",sessionID:"session-1",callID:"call-4",args:{path:join(workspace,"src"),pattern:"menu"}},output);
    await after({tool:"apply_patch",sessionID:"session-1",callID:"call-5",args:{patchText:"*** Begin Patch\n*** Update File: src/menu.ts\n*** End Patch"}},output);

    const resources=requests.filter(request=>request.eventType==="RESOURCE_ACCESSED").map(request=>request.payload);
    expect(resources).toEqual([
      {resourceType:"webpage",accessType:"read",tool:"webfetch",url:"https://example.test/docs"},
      {resourceType:"file",accessType:"read",tool:"read",path:"src/app.ts"},
      {resourceType:"file",accessType:"write",tool:"edit",path:"src/app.ts"},
      {resourceType:"directory",accessType:"search",tool:"grep",path:"src",pattern:"menu"},
      {resourceType:"file",accessType:"write",tool:"apply_patch",path:"src/menu.ts"}
    ]);
  });

  it("does not create a resource for tools without a resource target",async()=>{
    const requests:Record<string,unknown>[]=[];
    const fetchMock=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      requests.push(body);
      if("externalSessionId" in body)return new Response(JSON.stringify({context:{taskId:"task-1",sessionId:"session-1",runId:"run-1"}}),{status:200});
      return new Response(JSON.stringify({status:"accepted"}),{status:202});
    });
    vi.stubGlobal("fetch",fetchMock);
    const workspace=resolve("fixture-workspace");
    const hooks=await TraceForgePlugin({directory:workspace,worktree:workspace} as never);

    await hooks["tool.execute.after"]!({tool:"bash",sessionID:"session-1",callID:"call-1",args:{command:"npm test"}},{title:"done",output:"",metadata:{}});

    expect(requests.filter(request=>request.eventType==="RESOURCE_ACCESSED")).toHaveLength(0);
    expect(requests.filter(request=>request.eventType==="TEST_COMPLETED")).toHaveLength(1);
  });

  it("captures command completion metadata and before/after file hashes",async()=>{
    const requests:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      requests.push(body);
      if("externalSessionId" in body)return new Response(JSON.stringify({context:{taskId:"task-1",sessionId:"session-1",runId:"run-1"}}),{status:200});
      return new Response(JSON.stringify({status:"accepted"}),{status:202});
    }));

    const workspace=await mkdtemp(join(tmpdir(),"traceforge-plugin-hashes-"));
    cleanup.push(workspace);
    await mkdir(join(workspace,"src"));
    const filePath=join(workspace,"src","app.ts");
    await writeFile(filePath,"export const version = 1;\n","utf8");
    const hooks=await TraceForgePlugin({directory:workspace,worktree:workspace} as never);

    await hooks["tool.execute.before"]!({tool:"edit",sessionID:"session-1",callID:"call-edit"},{args:{filePath}});
    await writeFile(filePath,"export const version = 2;\n","utf8");
    await hooks["tool.execute.after"]!({tool:"edit",sessionID:"session-1",callID:"call-edit",args:{filePath}},{title:"done",output:"",metadata:{}});
    await hooks["tool.execute.after"]!({tool:"bash",sessionID:"session-1",callID:"call-test",args:{command:"npm test"}},{title:"done",output:"12 passed, 0 failed",metadata:{exitCode:0}});

    const generated=requests.find(request=>request.eventType==="GENERATED_CODE_CAPTURED")?.payload as Record<string,unknown>;
    expect(generated).toMatchObject({path:"src/app.ts",fileExistedBefore:true,fileExistsAfter:true});
    expect(generated?.fileHashBefore).not.toBe(generated?.fileHashAfter);
    const test=requests.find(request=>request.eventType==="TEST_COMPLETED")?.payload as Record<string,unknown>;
    expect(test).toMatchObject({command:"npm test",exitCode:0,passed:12,failed:0});
  });

  it("captures final generated code and excludes sensitive files",async()=>{
    const requests:Record<string,unknown>[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      requests.push(body);
      if("externalSessionId" in body)return new Response(JSON.stringify({context:{taskId:"task-1",sessionId:"session-1",runId:"run-1"}}),{status:200});
      return new Response(JSON.stringify({status:"accepted"}),{status:202});
    }));

    const workspace=await mkdtemp(join(tmpdir(),"traceforge-plugin-"));
    cleanup.push(workspace);
    await mkdir(join(workspace,"src"));
    await writeFile(join(workspace,"src","app.ts"),"export const app = true;\n","utf8");
    await writeFile(join(workspace,".env"),"SECRET=value\n","utf8");
    const hooks=await TraceForgePlugin({directory:workspace,worktree:resolve(workspace,"..")} as never);
    const output={title:"done",output:"",metadata:{}};

    await hooks["tool.execute.after"]!({tool:"write",sessionID:"session-1",callID:"call-1",args:{filePath:join(workspace,"src","app.ts")}},output);
    await hooks["tool.execute.after"]!({tool:"write",sessionID:"session-1",callID:"call-2",args:{filePath:join(workspace,".env")}},output);

    const generated=requests.filter(request=>request.eventType==="GENERATED_CODE_CAPTURED").map(request=>request.payload);
    expect(generated).toEqual([{path:"src/app.ts",code:"export const app = true;\n",operation:"write"}]);
  });
});

function restoreEnvironment(name:string,value:string|undefined):void{
  if(value===undefined)delete process.env[name];
  else process.env[name]=value;
}
