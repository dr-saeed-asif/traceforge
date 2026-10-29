import { expect, it } from "vitest";
// @ts-expect-error Standard-library-only research tooling is plain JavaScript.
import { clopperPearson, partitionExperiments, ratioBootstrap } from "../research/robustness/scripts/statistics.mjs";
// @ts-expect-error Standard-library-only research tooling is plain JavaScript.
import { sourceDigest } from "../research/robustness/scripts/freeze.mjs";

it("allows checkout line-ending conversion in source but freezes evidence bytes", () => {
  expect(sourceDigest("module.ts",Buffer.from("const n=1;\n"))).toBe(sourceDigest("module.ts",Buffer.from("const n=1;\r\n")));
  expect(sourceDigest("trace.jsonl",Buffer.from("{}\n"))).not.toBe(sourceDigest("trace.jsonl",Buffer.from("{}\r\n")));
  expect(sourceDigest("module.ts",Buffer.from("const n=1;\n"))).not.toBe(sourceDigest("module.ts",Buffer.from("const n=2;\n")));
});

it("computes exact boundary and non-boundary binomial intervals", () => {
  expect(clopperPearson(0,96).upper).toBeCloseTo(1-Math.pow(.025,1/96),12);
  expect(clopperPearson(96,96).lower).toBeCloseTo(Math.pow(.025,1/96),12);
  const middle=clopperPearson(5,10);
  expect(middle.lower).toBeCloseTo(.1870860284,9);
  expect(middle.upper).toBeCloseTo(.8129139716,9);
  expect(clopperPearson(0,0)).toMatchObject({available:false,lower:null,upper:null});
  expect(()=>clopperPearson(2,1)).toThrow();
  expect(()=>clopperPearson(.5,1)).toThrow();
});

it("does not pool models, seeds, versions, datasets or alignment methods", () => {
  const identity={policyVersion:"3.1.0",extractionVersion:"3.2.0",datasetSha256:"a",alignment:"exact",extractor:"oracle",baseline:"llm",model:"small",modelSeed:1};
  const rows=[identity,{...identity,modelSeed:2},{...identity,model:"large"},{...identity,policyVersion:"3.2.0"},{...identity,alignment:"coverage"},{...identity,datasetSha256:"b"}];
  expect(partitionExperiments(rows)).toHaveLength(6);
  expect(partitionExperiments([identity,{...identity}])).toHaveLength(1);
  expect(()=>partitionExperiments([{model:"missing fields"}])).toThrow();
});

it("resamples whole families and reports unavailable zero denominators", () => {
  const rows=[{sessionId:"s1",familyId:"f1",n:0,d:1},{sessionId:"s2",familyId:"f1",n:1,d:1}];
  expect(ratioBootstrap(rows,"n","d","familyId",100,7)).toMatchObject({available:false,clusters:1});
  const result=ratioBootstrap(rows,"n","d","sessionId",100,7);
  expect(result).toEqual(ratioBootstrap(rows,"n","d","sessionId",100,7));
  expect(result.clusters).toBe(2);
  expect(ratioBootstrap(rows.map(r=>({...r,n:0,d:0})),"n","d","sessionId",100,7)).toMatchObject({available:false,lower:null,upper:null,validReplicates:0});
  expect(()=>ratioBootstrap([{n:1,d:1}],"n","d")).toThrow();
});
