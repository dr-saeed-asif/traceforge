import {expect,it,vi,afterEach} from 'vitest';
import {extractClaims,expectationFor} from '../src/modules/verification/application/claim-extractor.js';
import {verifyClaim} from '../src/modules/verification/application/claim-verifier.js';
import {modelJudge} from '../src/research/baselines.js';
import type {ExtractedClaim,VerificationEvidence} from '../src/modules/verification/domain/contracts.js';
import {cohenKappa} from '../research/revision-r1/annotation-agreement.mjs';
const claim:ExtractedClaim={claimIndex:1,claimText:'`npm test` passed.',claimType:'TEST_PASSED',target:'npm test',expectedResult:'success'};
const event=(target:string,type='TEST_COMPLETED'):VerificationEvidence=>({promptId:'p',eventId:target,sequenceNumber:1,eventType:type as VerificationEvidence['eventType'],outcome:'SUCCEEDED',occurredAt:'2026-10-29T00:00:00Z',target,metadata:{exitCode:0,passed:1,failed:0,changedPaths:[],workspaceObservation:'complete',fileExistedBefore:false,fileExistsAfter:true,fileHashAfter:'a'}});
afterEach(()=>vi.unstubAllGlobals());
it('rejects selectors, runner operands and mode-changing extensions',()=>{
 for(const extension of ['-- -t login','-t login','--testNamePattern=login','-k login','--grep login','-g login','--dry-run','--watch','--listTests','--onlyChanged','tests/login.test.js','tests/'])expect(verifyClaim(claim,[event('npm test '+extension)]).verdict).toBe('UNSUPPORTED');
 expect(verifyClaim(claim,[event('cd app && npm test')]).verdict).toBe('VERIFIED');
 expect(verifyClaim(claim,[event('echo "a && npm test && b"')]).verdict).toBe('UNSUPPORTED');
});
it('only admits path arguments for file executors',()=>{
 const c={...claim,claimType:'COMMAND_SUCCEEDED' as const,target:'check.js'};
 for(const reader of ['cat','less','head','tail','ls','grep','wc','stat'])expect(verifyClaim(c,[event(reader+' check.js','COMMAND_COMPLETED')]).verdict).toBe('UNSUPPORTED');
 expect(verifyClaim(c,[event('node check.js','COMMAND_COMPLETED')]).verdict).toBe('VERIFIED');
});
it('rejects ambiguous observed file suffixes',()=>{
 const c={...claim,claimType:'FILE_CREATED' as const,target:'x.ts'};
 const result=verifyClaim(c,[event('src/x.ts','FILE_CREATED'),{...event('test/x.ts','FILE_CREATED'),sequenceNumber:2}]);expect(result.verdict).toBe('UNSUPPORTED');expect(result.explanation).toContain('Ambiguous');
});
it('extracts passive file operations and cleans parenthesized command targets',()=>{
 for(const verb of ['created','added','updated','modified'])expect(extractClaims(`src/x.ts has been ${verb}.`)[0]?.target).toBe('src/x.ts');
 expect(extractClaims('Syntax check (node --check x.cjs) passed.')[0]?.target).toBe('node --check x.cjs');
});
it('requires behavioral evidence for state predicates',()=>{
 for(const text of ['The bug is now fixed.','The issue has been fixed.','The issue is resolved.','Validation works now.'])expect(expectationFor(text,'FILE_MODIFIED').basis).toBe('behavior');
 expect(expectationFor('The file has been updated.','FILE_MODIFIED').basis).toBe('operation');
});
it('uses constrained decoding, strips gold, repairs once, retains attempt errors',async()=>{
 const requests:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({done:true,message:{content:requests.length===1?'{}':JSON.stringify({verdict:'VERIFIED',reason:'observed',requestEventIds:[]})},prompt_eval_count:10,eval_count:5}),{status:200});}));
 const result=await modelJudge({...claim,verdict:'GOLD_SECRET'} as ExtractedClaim,[event('npm test')],{model:'fixture',endpoint:'http://127.0.0.1:11434/api/chat',agent:false,seed:7,promptQuery:'',finalResponse:claim.claimText});
 expect(result.verdict).toBe('VERIFIED');expect(result.attempts).toHaveLength(2);expect(requests[0].format.type).toBe('object');expect(JSON.stringify(requests)).not.toContain('GOLD_SECRET');expect((result.attempts[0] as any).error).not.toBe('');
});
it('retains an error after the single repair budget',async()=>{
 const mock=vi.fn(async()=>new Response(JSON.stringify({done:true,message:{content:'{}'}}),{status:200}));vi.stubGlobal('fetch',mock);
 await expect(modelJudge(claim,[],{model:'fixture',endpoint:'http://localhost:11434/api/chat',agent:false,seed:7,promptQuery:'',finalResponse:''})).rejects.toMatchObject({attempts:expect.any(Array)});expect(mock).toHaveBeenCalledTimes(2);
});
it('computes paired chance-corrected agreement and keeps undefined kappa unavailable',()=>{
 expect(cohenKappa(['A','A','B','B'],['A','B','A','B']).kappa).toBe(0);
 expect(cohenKappa(['A','A'],['A','A']).kappa).toBeNull();
 expect(()=>cohenKappa(['A'],[])).toThrow();
});
