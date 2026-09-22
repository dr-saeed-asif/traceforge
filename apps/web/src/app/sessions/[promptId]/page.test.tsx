import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionDetails } = vi.hoisted(() => ({ getSessionDetails: vi.fn() }));

vi.mock("@/lib/traceforge-api", () => {
  class MockTraceForgeApiError extends Error {
    public readonly status: number | null;

    public constructor(
      public readonly code: string,
      message: string,
      options: { status?: number } = {}
    ) {
      super(message);
      this.status = options.status ?? null;
    }
  }

  return {
    createTraceForgeApiClient: () => ({ getSessionDetails }),
    TraceForgeApiError: MockTraceForgeApiError
  };
});

import SessionDetailPage from "./page";

const hash = "a".repeat(64);

const response = {
  session: {
    promptId: "prompt-session-1",
    externalSessionId: "external-1",
    runId: "run-1",
    projectName: "TraceForge",
    projectPath: "H:/TraceForge",
    agentName: "OpenCode",
    modelName: "verification-model",
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
    completedAt: "2026-09-21T10:05:00.000Z"
  },
  claims: [
    {
      claimIndex: 1,
      claimText: "The dashboard file was created.",
      claimType: "FILE_CREATED",
      target: "apps/web/src/app/page.tsx",
      expectedResult: "The file exists after execution.",
      verdict: "VERIFIED",
      reasonCode: "REQUIRED_EVIDENCE_CONFIRMED",
      explanation: "The captured file event confirms the final state.",
      evidenceEventIds: ["event-1"],
      extractorModel: "verification-model",
      extractionPromptVersion: "1.0.0",
      verificationRuleVersion: "1.0.0",
      verifiedAt: "2026-09-21T10:05:00.000Z"
    }
  ],
  traceEvents: [
    {
      id: 1,
      eventId: "event-1",
      sequenceNumber: 1,
      eventType: "FILE_CREATED",
      outcome: "SUCCEEDED",
      occurredAt: "2026-09-21T10:01:00.000Z",
      target: "apps/web/src/app/page.tsx",
      toolName: "write",
      filePath: "apps/web/src/app/page.tsx",
      command: null,
      workingDirectory: null,
      exitCode: null,
      testPassed: null,
      testFailed: null,
      testSkipped: null,
      fileExistedBefore: false,
      fileExistsAfter: true,
      fileHashBefore: null,
      fileHashAfter: hash,
      outputHash: null,
      previousEventHash: null,
      eventHash: hash,
      metadata: { source: "tool.execute.after" }
    }
  ]
} as const;

describe("SessionDetailPage", () => {
  beforeEach(() => {
    getSessionDetails.mockReset();
    getSessionDetails.mockResolvedValue(response);
  });

  it("connects claims to highlighted evidence and renders hash information", async () => {
    render(await SessionDetailPage({ params: Promise.resolve({ promptId: "prompt-session-1" }) }));

    expect(screen.getByRole("heading", { name: "TraceForge", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("The dashboard file was created.")).toBeInTheDocument();
    expect(screen.getByText("Required Evidence Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Event #1" })).toHaveAttribute(
      "href",
      "#event-event-1"
    );
    expect(screen.getByRole("link", { name: "Claim 1" })).toHaveAttribute("href", "#claim-1");
    expect(screen.getByRole("heading", { name: "File Created", level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/Hash chain/u)).toBeInTheDocument();
  });

  it("uses the decoded prompt identifier for the secure API request", async () => {
    render(
      await SessionDetailPage({ params: Promise.resolve({ promptId: "prompt with spaces" }) })
    );

    expect(getSessionDetails).toHaveBeenCalledWith("prompt with spaces");
  });

  it("renders explicit empty claim and event states", async () => {
    getSessionDetails.mockResolvedValue({
      ...response,
      session: {
        ...response.session,
        totalClaims: 0,
        verifiedClaims: 0,
        scoredClaims: 0,
        reliabilityPercent: null,
        coveragePercent: null
      },
      claims: [],
      traceEvents: []
    });

    render(await SessionDetailPage({ params: Promise.resolve({ promptId: "prompt-session-1" }) }));

    expect(
      screen.getByText("No objective claims were extracted from the final response.")
    ).toBeInTheDocument();
    expect(screen.getByText("No trace events were captured for this session.")).toBeInTheDocument();
  });

  it("renders a safe error when session loading fails", async () => {
    getSessionDetails.mockRejectedValue(new Error("private upstream detail"));

    render(await SessionDetailPage({ params: Promise.resolve({ promptId: "missing" }) }));

    expect(screen.getByRole("heading", { name: "Unable to load session" })).toBeInTheDocument();
    expect(screen.queryByText(/private upstream/u)).not.toBeInTheDocument();
  });
});
