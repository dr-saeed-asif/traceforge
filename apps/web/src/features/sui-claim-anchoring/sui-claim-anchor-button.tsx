"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui";
import type {
  VerificationClaim,
  VerificationSession,
  VerificationTraceEvent
} from "@traceforge/verification-contracts";

const SuiClaimAnchorWallet = dynamic(
  () => import("./sui-claim-anchor-wallet").then((module) => module.SuiClaimAnchorWallet),
  {
    ssr: false,
    loading: () => (
      <Button size="sm" variant="secondary" disabled>
        Anchor on Sui
      </Button>
    )
  }
);

export function SuiClaimAnchorButton({
  session,
  claim,
  traceEvents
}: Readonly<{
  session: VerificationSession;
  claim: VerificationClaim;
  traceEvents: readonly VerificationTraceEvent[];
}>) {
  return <SuiClaimAnchorWallet session={session} claim={claim} traceEvents={traceEvents} />;
}
