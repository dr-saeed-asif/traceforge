# Provenance dashboard

The TraceForge provenance workbench is a responsive server-rendered dashboard in `apps/dashboard`. It presents run integrity, normalized event chronology, artifacts, authenticated approval identity, model/provider attribution, and Git correlation without claiming hidden reasoning.

The current hosted version uses a clearly labeled demo run. This validates the dashboard composition and hosting surface; it is not evidence from a live collector. Production composition will connect the dashboard to the authenticated v1 API through private HTTP connectivity and replace the demo fixture with authorized query results.

The dashboard includes keyboard-accessible tabs and event filters, mobile navigation, reduced-motion support, server-rendered content checks, and dynamic social metadata based on the incoming request host.
