import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const token = "traceforge-e2e-server-token";
const e2eDistDirectory = `.next-e2e-${process.pid}`;
const e2eTsconfig = `.tsconfig-e2e-${process.pid}.json`;
const requestedApiUrls = [];
const hash = "a".repeat(64);

const session = {
  promptId: "prompt-e2e",
  externalSessionId: "external-e2e",
  runId: "run-e2e",
  projectName: "TraceForge E2E",
  projectPath: "/workspace/traceforge",
  agentName: "OpenCode",
  modelName: "e2e-model",
  executionStatus: "COMPLETED",
  extractionStatus: "SUCCEEDED",
  verificationStatus: "SUCCEEDED",
  totalClaims: 1,
  verifiedClaims: 1,
  contradictedClaims: 0,
  unsupportedClaims: 0,
  unverifiableClaims: 0,
  scoredClaims: 1,
  reliabilityPercent: 100,
  coveragePercent: 100,
  startedAt: "2026-09-21T10:00:00.000Z",
  completedAt: "2026-09-21T10:01:00.000Z"
};

const traceEvent = {
  id: 1,
  eventId: "event-e2e",
  sequenceNumber: 1,
  eventType: "TEST_COMPLETED",
  outcome: "SUCCEEDED",
  occurredAt: "2026-09-21T10:00:30.000Z",
  target: "web tests",
  toolName: "bash",
  filePath: null,
  command: "npm run web:test",
  workingDirectory: "/workspace/traceforge",
  exitCode: 0,
  testPassed: 17,
  testFailed: 0,
  testSkipped: 0,
  fileExistedBefore: null,
  fileExistsAfter: null,
  fileHashBefore: null,
  fileHashAfter: null,
  outputHash: hash,
  previousEventHash: null,
  eventHash: hash,
  metadata: { runner: "vitest" }
};

const claim = {
  claimIndex: 1,
  claimText: "The frontend tests passed.",
  claimType: "TEST_PASSED",
  target: "apps/web",
  expectedResult: "The test command exits successfully.",
  verdict: "VERIFIED",
  reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
  explanation: "The latest test completion event reports zero failures.",
  evidenceEventIds: [traceEvent.eventId],
  extractorModel: "e2e-model",
  extractionPromptVersion: "1.0.0",
  verificationRuleVersion: "1.0.0",
  verifiedAt: "2026-09-21T10:01:00.000Z"
};

const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://traceforge-api.test");
  requestedApiUrls.push(url);

  if (request.headers.authorization !== `Bearer ${token}`) {
    return sendJson(response, 401, { error: "unauthorized" });
  }
  if (url.pathname === "/api/v1/verification/overview") {
    return sendJson(response, 200, {
      overview: {
        totalSessions: 1,
        totalClaims: 1,
        verifiedClaims: 1,
        contradictedClaims: 0,
        unsupportedClaims: 0,
        unverifiableClaims: 0,
        scoredClaims: 1,
        reliabilityPercent: 100,
        coveragePercent: 100
      },
      sessions: [session],
      pagination: { limit: 8, offset: 0, returned: 1 }
    });
  }
  if (url.pathname === "/api/v1/verification/sessions") {
    return sendJson(response, 200, {
      sessions: [session],
      pagination: { limit: 20, offset: 0, returned: 1 }
    });
  }
  if (url.pathname === "/api/v1/verification/sessions/prompt-e2e") {
    return sendJson(response, 200, {
      session,
      claims: [claim],
      traceEvents: [traceEvent]
    });
  }
  return sendJson(response, 404, { error: "not_found" });
});

let webProcess;
let webOutput = "";

try {
  await listen(api);
  const apiAddress = api.address();
  assert(apiAddress && typeof apiAddress !== "string");
  const webPort = await availablePort();
  const require = createRequire(import.meta.url);
  const nextDirectory = dirname(require.resolve("next/package.json"));
  const nextBinary = join(nextDirectory, "dist", "bin", "next");
  await writeFile(
    join(appDirectory, e2eTsconfig),
    `${JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { incremental: false },
        include: ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  webProcess = spawn(
    process.execPath,
    [nextBinary, "dev", "--hostname", "127.0.0.1", "--port", String(webPort)],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        TRACEFORGE_API_URL: `http://127.0.0.1:${apiAddress.port}`,
        TRACEFORGE_API_TOKEN: token,
        TRACEFORGE_API_TIMEOUT_MS: "5000",
        TRACEFORGE_NEXT_DIST_DIR: e2eDistDirectory,
        TRACEFORGE_NEXT_TSCONFIG: e2eTsconfig
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  webProcess.stdout.on("data", rememberOutput);
  webProcess.stderr.on("data", rememberOutput);

  const baseUrl = `http://127.0.0.1:${webPort}`;
  await waitUntilReady(`${baseUrl}/api/health`, webProcess);

  await expectPage(baseUrl, "/", ["Verification overview", "TraceForge E2E", "100%"]);
  await expectPage(baseUrl, "/sessions?from=2026-09-01&to=2026-09-21", [
    "Captured sessions",
    "OpenCode",
    "prompt-e2e"
  ]);
  await expectPage(baseUrl, "/sessions/prompt-e2e", [
    "Extracted claims",
    "Required Evidence Confirmed",
    "Trace-event timeline",
    "17 passed"
  ]);
  await expectPage(baseUrl, "/sessions?page=invalid", ["Invalid session filters"]);

  const filteredRequest = requestedApiUrls.find(
    (url) => url.pathname === "/api/v1/verification/sessions"
  );
  assert(filteredRequest, "The sessions route did not call the TraceForge API");
  assert.equal(filteredRequest.searchParams.get("startedAfter"), "2026-09-01T00:00:00.000Z");
  assert.equal(filteredRequest.searchParams.get("startedBefore"), "2026-09-22T00:00:00.000Z");

  process.stdout.write("TraceForge web E2E journey passed.\n");
} catch (error) {
  if (webOutput) process.stderr.write(`\nNext.js output:\n${webOutput}\n`);
  throw error;
} finally {
  api.close();
  if (webProcess && webProcess.exitCode === null) {
    webProcess.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => webProcess.once("exit", resolve)), delay(5_000)]);
    if (webProcess.exitCode === null) {
      webProcess.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => webProcess.once("exit", resolve)),
        delay(5_000)
      ]);
    }
  }
  await rm(join(appDirectory, e2eDistDirectory), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200
  });
  await rm(join(appDirectory, e2eTsconfig), { force: true });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function availablePort() {
  const probe = createServer();
  await listen(probe);
  const address = probe.address();
  assert(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function waitUntilReady(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await delay(250);
  }
  throw new Error("Next.js did not become ready within 60 seconds");
}

async function expectPage(baseUrl, path, expectedText) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  const html = await response.text();
  for (const text of expectedText) {
    assert(html.includes(text), `${path} did not include ${JSON.stringify(text)}`);
  }
}

function rememberOutput(chunk) {
  webOutput = `${webOutput}${String(chunk)}`.slice(-20_000);
}
