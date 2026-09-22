import type { SessionSearchParams } from "@/features/sessions/date-range";
import { SessionsClientWrapper } from "@/features/sessions/sessions-client-wrapper";

export const metadata = {
  title: "Agent verification sessions"
};

export const dynamic = "force-dynamic";

interface SessionsPageProps {
  readonly searchParams: Promise<SessionSearchParams>;
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  return <SessionsClientWrapper searchParams={searchParams} />;
}
