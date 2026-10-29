import { describe, expect, it } from "vitest";
import { mapCaptureEventToTraceEvent } from "../../../src/modules/verification/index.js";

describe("capture event mapper", () => {
  it("classifies file creation and hashes code instead of persisting source text", () => {
    const mapped = mapCaptureEventToTraceEvent({
      eventType: "GENERATED_CODE_CAPTURED",
      payload: {
        path: "src/app.ts",
        code: "export const app = true;",
        fileExistedBefore: false,
        fileExistsAfter: true,
        fileHashAfter: "after-hash"
      }
    });

    expect(mapped).toMatchObject({
      eventType: "FILE_CREATED",
      outcome: "SUCCEEDED",
      target: "src/app.ts",
      projections: { filePath: "src/app.ts", fileExistedBefore: false, fileExistsAfter: true, fileHashAfter: "after-hash" }
    });
    expect(mapped?.metadata).not.toHaveProperty("code");
    expect(mapped?.metadata.codeLength).toBe("export const app = true;".length);
  });

  it("maps model output to a final response while retaining only a digest", () => {
    const mapped = mapCaptureEventToTraceEvent({
      eventType: "MODEL_RESPONSE",
      payload: { responseText: "The implementation is complete.", messageId: "message-1" }
    });

    expect(mapped?.eventType).toBe("FINAL_RESPONSE_CAPTURED");
    expect(mapped?.metadata).not.toHaveProperty("responseText");
    expect(mapped?.metadata.responseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(mapped?.projections).toBeUndefined();
  });

  it("normalizes test commands and failure outcomes", () => {
    const mapped = mapCaptureEventToTraceEvent({
      eventType: "COMMAND_COMPLETED",
      payload: { command: "npm test", exitCode: 1, passed: 4, failed: 1, output: "4 passed, 1 failed" }
    });

    expect(mapped).toMatchObject({
      eventType: "TEST_COMPLETED",
      outcome: "FAILED",
      target: "npm test",
      projections: { command: "npm test", exitCode: 1, testPassed: 4, testFailed: 1, outputHash: expect.any(String) }
    });
  });

  it("ignores provider events that have no canonical verification meaning", () => {
    expect(mapCaptureEventToTraceEvent({ eventType: "PROVIDER_DEBUG_LOG", payload: { output: "debug" } })).toBeNull();
  });

  it("preserves successful architecture checks as successful evidence", () => {
    expect(mapCaptureEventToTraceEvent({ eventType: "ARCHITECTURE_CHECK", payload: { status: "PASSED" } })).toMatchObject({
      eventType: "ARCHITECTURE_CHECK_COMPLETED",
      outcome: "SUCCEEDED"
    });
  });
});
