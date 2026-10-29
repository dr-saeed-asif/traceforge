import { expect, it } from "vitest";
import {
  getBlockchainLatencyStorageKey,
  readBlockchainLatencyMeasurements,
  recordBlockchainLatencyMeasurement
} from "./latency-storage";

it("keeps approval-inclusive historical measurements out of transaction confirmation times", () => {
  const identity = { promptId: "timing-test", runId: "run", claimIndex: 1 };
  const key = getBlockchainLatencyStorageKey(identity);
  window.localStorage.clear();
  window.localStorage.setItem(
    key.replace(":v2:", ":v1:"),
    JSON.stringify({
      sui: {
        chain: "sui",
        elapsedMs: 60000,
        transactionId: "old",
        recordedAt: new Date().toISOString()
      }
    })
  );
  expect(readBlockchainLatencyMeasurements(identity)).toEqual({});
  recordBlockchainLatencyMeasurement(identity, "sui", 250, "new");
  expect(readBlockchainLatencyMeasurements(identity).sui).toMatchObject({
    elapsedMs: 250,
    transactionId: "new"
  });
  window.localStorage.clear();
});
