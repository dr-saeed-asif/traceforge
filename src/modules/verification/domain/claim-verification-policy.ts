import type { ClaimType } from "./claim-types.js";
import type { TraceEventType } from "./trace-event-types.js";

export const CLAIM_VERIFICATION_POLICY_VERSION = "3.1.0";

export const VERIFICATION_STRATEGIES = ["EVENT_EVIDENCE", "AGGREGATE_CLAIMS"] as const;

export type VerificationStrategy = (typeof VERIFICATION_STRATEGIES)[number];

/** Contract used by the deterministic verifier to select evidence. */
export interface ClaimVerificationPolicy {
  readonly claimType: ClaimType;
  readonly strategy: VerificationStrategy;
  readonly candidateEventTypes: readonly TraceEventType[];
  readonly objective: string;
}

/**
 * Exhaustive claim-to-evidence registry.
 *
 * `satisfies Record<ClaimType, ...>` intentionally makes TypeScript fail when
 * a new claim type is added without a corresponding verification policy.
 */
export const CLAIM_VERIFICATION_POLICIES = {
  FILE_CREATED: {
    claimType: "FILE_CREATED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["FILE_CREATED", "FILE_DELETED"],
    objective: "The target file was absent before the operation and exists afterward."
  },
  FILE_MODIFIED: {
    claimType: "FILE_MODIFIED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["FILE_MODIFIED", "FILE_DELETED"],
    objective: "The target file existed and its content hash changed to a relevant final state."
  },
  STRUCTURE_CREATED: {
    claimType: "STRUCTURE_CREATED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["DIRECTORY_CREATED", "FILE_CREATED", "FILE_DELETED"],
    objective: "All directories and files required by the declared structure exist in the final state."
  },
  DEPENDENCY_RULE: {
    claimType: "DEPENDENCY_RULE",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["ARCHITECTURE_CHECK_COMPLETED"],
    objective: "The configured architecture rule completed without forbidden dependency edges."
  },
  COMMAND_SUCCEEDED: {
    claimType: "COMMAND_SUCCEEDED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["COMMAND_COMPLETED", "TEST_COMPLETED", "BUILD_COMPLETED"],
    objective: "The matching command completed in the intended workspace with exit code zero."
  },
  BUILD_PASSED: {
    claimType: "BUILD_PASSED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["BUILD_COMPLETED"],
    objective: "The latest relevant build completed successfully after the final code change."
  },
  TEST_PASSED: {
    claimType: "TEST_PASSED",
    strategy: "EVENT_EVIDENCE",
    candidateEventTypes: ["TEST_COMPLETED"],
    objective: "The latest relevant test run has exit code zero and no failed tests."
  },
  TASK_COMPLETED: {
    claimType: "TASK_COMPLETED",
    strategy: "AGGREGATE_CLAIMS",
    candidateEventTypes: [],
    objective: "All other objective claims extracted from the same report are verified (report consistency, not requirement coverage)."
  }
} as const satisfies Record<ClaimType, ClaimVerificationPolicy>;

export function getClaimVerificationPolicy(claimType: ClaimType): ClaimVerificationPolicy {
  return CLAIM_VERIFICATION_POLICIES[claimType];
}
