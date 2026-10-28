import { expect, it } from "vitest";
import { classifyClaimType, extractTargetAndExpectedResult } from "../../../src/modules/verification/application/claim-extractor.js";
import { verifyClaim } from "../../../src/modules/verification/application/claim-verifier.js";
import type { ExtractedClaim, VerificationEvidence } from "../../../src/modules/verification/domain/contracts.js";

const syntax: ExtractedClaim={claimIndex:1,claimText:"`node --check search.cjs` passed.",claimType:"COMMAND_SUCCEEDED",target:"node --check search.cjs",expectedResult:"exit code 0"};
const testEvent:VerificationEvidence={promptId:"p",eventId:"test",sequenceNumber:1,eventType:"TEST_COMPLETED",outcome:"SUCCEEDED",occurredAt:"2026-10-28T00:00:00Z",target:"node --test search.test.cjs",metadata:{command:"node --test search.test.cjs",exitCode:0,passed:5,failed:0}};

it("distinguishes syntax checks, builds, and tests despite the word passed",()=>{
 expect(classifyClaimType(syntax.claimText)).toBe("COMMAND_SUCCEEDED");
 expect(classifyClaimType("The build passed.")).toBe("BUILD_PASSED");
 expect(classifyClaimType("All 5 tests passed.")).toBe("TEST_PASSED");
 expect(extractTargetAndExpectedResult(syntax.claimText,"COMMAND_SUCCEEDED").target).toBe(syntax.target);
 expect(extractTargetAndExpectedResult("node --check search.cjs passed.","COMMAND_SUCCEEDED").target).toBe(syntax.target);
});
it("does not verify or contradict a syntax check using another command's event",()=>{
 expect(verifyClaim(syntax,[testEvent]).verdict).toBe("UNSUPPORTED");
 expect(verifyClaim(syntax,[{...testEvent,outcome:"FAILED",metadata:{exitCode:1}}]).verdict).toBe("UNSUPPORTED");
 expect(verifyClaim(syntax,[testEvent],[],{targetMatching:"legacy-token"}).verdict).toBe("VERIFIED");
 const exact={...testEvent,eventType:"COMMAND_COMPLETED" as const,target:syntax.target,metadata:{exitCode:0}};
 expect(verifyClaim(syntax,[exact]).evidence[0]?.eventId).toBe("test");
});
it("keeps distinct file paths and command operands distinct",()=>{
 const command={...syntax,target:"node --check Search.cjs"};
 expect(verifyClaim(command,[{...testEvent,eventType:"COMMAND_COMPLETED",target:syntax.target}]).verdict).toBe("UNSUPPORTED");
 const file={...syntax,claimType:"FILE_CREATED" as const,target:"src/a.ts"};
 expect(verifyClaim(file,[{...testEvent,eventType:"FILE_CREATED",target:"src/a.ts.bak",metadata:{fileExistedBefore:false,fileExistsAfter:true,fileHashAfter:"a"}}]).verdict).toBe("UNSUPPORTED");
});
