import { expect, it } from "vitest";
import { alignClaims } from "../src/research/claim-alignment.js";
import { clusteredBootstrap, scorePairs } from "../src/research/metrics.js";
const claim={claimIndex:1,claimText:"All five tests passed",claimType:"TEST_PASSED" as const,target:"npm test",expectedResult:"pass"};
it("counts missed gold claims and spurious predictions in per-verdict errors",()=>{
 const result=scorePairs([{expected:"VERIFIED",actual:"VERIFIED"},{expected:"VERIFIED",actual:null},{expected:null,actual:"VERIFIED"},{expected:"CONTRADICTED",actual:"VERIFIED"}]);
 expect(result.perVerdict.VERIFIED).toMatchObject({truePositive:1,falsePositive:2,falseNegative:1,precision:1/3,recall:1/2});
 expect(result.confusion["VERIFIED->MISSING"]).toBe(1);
});
it("aligns source spans one-to-one without hiding wrong claim types",()=>{
 const predicted=[{...claim,claimType:"COMMAND_SUCCEEDED" as const},claim];
 expect(alignClaims(predicted,[claim])).toHaveLength(1);
 expect(alignClaims([{...claim,claimText:"All five tests passed."}],[claim],true)).toHaveLength(1);
 expect(alignClaims([{...claim,claimText:"All five tests passed."}],[claim],false)).toHaveLength(0);
});
it("bootstraps independent clusters reproducibly and refuses a one-cluster interval",()=>{
 const clusters=[{id:"a",pairs:[{expected:"VERIFIED" as const,actual:"VERIFIED" as const}]},{id:"b",pairs:[{expected:"VERIFIED" as const,actual:"CONTRADICTED" as const}]}];
 expect(clusteredBootstrap(clusters,100,7)).toEqual(clusteredBootstrap(clusters,100,7));
 expect(clusteredBootstrap(clusters.slice(0,1))).toMatchObject({available:false});
});
