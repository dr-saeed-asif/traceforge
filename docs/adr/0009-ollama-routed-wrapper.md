# ADR 0009: Ollama routed wrapper with independent provenance completion

- Status: Accepted
- Date: 2026-08-22

## Context

Ollama exposes model requests and streamed responses but has no agent hooks for filesystem, terminal, resource, or external tool execution. Consuming a response for provenance must not steal its stream from the caller.

## Decision

Wrap `/api/chat` and `/api/generate`, clone the upstream `Response`, and parse the clone under a fixed capture limit. Return the original response plus an explicit provenance promise. Aggregate streamed content and final metrics into one normalized model response event.

Record model-requested tool calls only inside the model response. Do not emit tool-started or tool-completed events. Record only the presence of provider-exposed thinking and never persist its raw text.

## Consequences

Callers retain native streaming behavior and can choose when to await capture durability. Clone buffering adds bounded memory and CPU overhead. Calls bypassing the wrapper are invisible. Capture can fail after the model response is already available, so consumers requiring strict provenance must await the provenance promise before treating a run as complete.
