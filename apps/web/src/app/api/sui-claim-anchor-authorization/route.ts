import { createBlockchainClaimAnchorManifest, createBlockchainClaimAnchorPayload } from "@traceforge/claim-anchoring";
import { NextRequest, NextResponse } from "next/server";
import { createTraceForgeApiClient } from "@/lib/traceforge-api";
import { getSuiSignerPublicKey, signSuiClaimAnchorAuthorization } from "@/lib/sui-claim-anchor-signing";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ signerPublicKey: getSuiSignerPublicKey() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sui signing is not configured." }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Send a JSON request body." }, { status: 400 }); }
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid authorization request." }, { status: 400 });
  const { promptId, claimIndex } = input as Record<string, unknown>;
  if (typeof promptId !== "string" || !promptId.trim() || typeof claimIndex !== "number" || !Number.isSafeInteger(claimIndex) || claimIndex < 0 || claimIndex > 0xffff_ffff) return NextResponse.json({ error: "A valid promptId and claimIndex are required." }, { status: 400 });
  try {
    const details = await createTraceForgeApiClient().getSessionDetails(promptId);
    const claim = details.claims.find((candidate) => candidate.claimIndex === claimIndex);
    if (!claim || claim.verdict !== "VERIFIED" || claim.verifiedAt === null) return NextResponse.json({ error: "Only a stored VERIFIED claim can be authorized." }, { status: 409 });
    const manifest = createBlockchainClaimAnchorManifest(details.session, claim, details.traceEvents);
    const payload = await createBlockchainClaimAnchorPayload(manifest);
    return NextResponse.json({ payload, ...(await signSuiClaimAnchorAuthorization(payload)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorize this Sui claim.";
    return NextResponse.json({ error: message }, { status: message.includes("not configured") ? 503 : 502 });
  }
}
