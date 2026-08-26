# ADR 0010: Use routed, lossless hosted-provider gateways

## Status

Accepted.

## Decision

Hosted-provider observation uses an explicit provider-neutral gateway contract. A shared engine forwards caller-owned request objects and headers without translating them, returns the original response, and normalizes a bounded clone through an isolated provider profile.

Tool calls are recorded as model output, not tool execution. Provider-exposed reasoning or thinking content is discarded. Authentication headers are runtime inputs and never provenance fields.

## Consequences

TraceForge can observe both JSON and SSE responses without coupling the domain to provider types. Applications must route calls through the gateway and await the provenance promise when they need completion guarantees. Protocol changes are contained in profiles, but profile fixtures must be updated when official wire formats change.
