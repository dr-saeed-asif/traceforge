import type { VerificationSessionDetailsResponse } from "@traceforge/verification-contracts";
import { PageContainer, PageHeader } from "@/components/page-container";
import { ButtonLink, ErrorState } from "@/components/ui";
import { ClaimsTable } from "@/features/session-details/claims-table";
import { SessionSummary } from "@/features/session-details/session-summary";
import styles from "@/features/session-details/session-details.module.css";
import { TraceTimeline } from "@/features/session-details/trace-timeline";
import { createTraceForgeApiClient, TraceForgeApiError } from "@/lib/traceforge-api";

export const dynamic = "force-dynamic";

interface SessionDetailPageProps {
  readonly params: Promise<{ promptId: string }>;
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { promptId } = await params;
  let response: VerificationSessionDetailsResponse;

  try {
    response = await createTraceForgeApiClient().getSessionDetails(promptId);
  } catch (error) {
    const notFound = error instanceof TraceForgeApiError && error.status === 404;
    return (
      <PageContainer size="narrow">
        <PageHeader
          eyebrow="Session investigation"
          title={notFound ? "Session not found" : "Unable to load session"}
          description={
            notFound
              ? "The requested prompt is not available in the verification store."
              : "TraceForge could not load the claims and evidence for this prompt."
          }
        />
        <ErrorState
          {...(notFound ? { title: "No matching session" } : {})}
          description={sessionDetailErrorMessage(error)}
          action={
            <ButtonLink href="/sessions" variant="secondary">
              Back to sessions
            </ButtonLink>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Session investigation"
        title={response.session.projectName ?? "Captured prompt"}
        description={`Inspect deterministic claim verdicts and the immutable evidence trail for prompt ${response.session.promptId}.`}
        actions={
          <div className={styles.headerActions}>
            <ButtonLink href="#claims" size="sm" variant="ghost">
              Claims
            </ButtonLink>
            <ButtonLink href="#trace-events" size="sm" variant="ghost">
              Trace events
            </ButtonLink>
            <ButtonLink href="/sessions" size="sm" variant="secondary">
              All sessions
            </ButtonLink>
          </div>
        }
      />
      <div className={styles.detailStack}>
        <SessionSummary session={response.session} />
        <ClaimsTable claims={response.claims} traceEvents={response.traceEvents} />
        <TraceTimeline traceEvents={response.traceEvents} claims={response.claims} />
      </div>
    </PageContainer>
  );
}

function sessionDetailErrorMessage(error: unknown): string {
  if (!(error instanceof TraceForgeApiError)) {
    return "The session investigation could not load. Try again after the TraceForge API is available.";
  }
  if (error.code === "HTTP_ERROR" && error.status === 404) {
    return "Return to the sessions list and choose an available captured prompt.";
  }
  if (error.code === "CONFIGURATION_ERROR") {
    return "The server-side TraceForge API configuration is incomplete. Check the web environment settings.";
  }
  if (error.code === "TIMEOUT") {
    return "The TraceForge API took too long to return this investigation. Try loading it again.";
  }
  if (error.code === "INVALID_RESPONSE") {
    return "The TraceForge API returned unexpected claim or evidence data. Check the shared contracts.";
  }
  if (error.code === "HTTP_ERROR" && error.status === 401) {
    return "The TraceForge API rejected the server credential. Check the configured bearer token.";
  }
  return "The TraceForge API is currently unavailable. Try loading this investigation again.";
}
