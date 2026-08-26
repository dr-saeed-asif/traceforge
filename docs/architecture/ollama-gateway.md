# Ollama gateway adapter

## Audited API surface

The gateway was reviewed on 2026-08-22 against Ollama's:

- [official API reference](https://docs.ollama.com/api/);
- [official chat endpoint reference](https://docs.ollama.com/api/chat);
- [official streaming documentation](https://docs.ollama.com/api/streaming);
- [official OpenAPI specification](https://github.com/ollama/ollama/blob/main/docs/openapi.yaml).

The official API defines streaming `/api/chat` and `/api/generate` endpoints, newline-delimited JSON chunks, final timing/token statistics, optional model-requested tool calls, and optional thinking-model output.

## Wrapper behavior

`OllamaGateway` forwards request JSON to a configured Ollama base URL without changing it. Before forwarding, it records a redaction-bound prompt and model request. It clones the returned `Response`, returning the original response to the caller while consuming only the clone for provenance.

The return value contains:

```typescript
interface OllamaGatewayResponse {
  response: Response;
  provenance: Promise<void>;
}
```

Callers may consume streaming bytes normally and await `provenance` when capture durability matters. Capture is bounded to 16 MiB by default. Overflow rejects the provenance promise and creates an `ERROR` event without consuming or cancelling the caller's response branch.

Only traffic routed through this wrapper is observable. Direct calls to Ollama are outside TraceForge's evidence boundary.

## Captured values

- latest user prompt for chat, or generate prompt;
- requested model name/tag and selected request flags;
- concatenated response text;
- model-returned name;
- prompt and output token counts;
- load, prompt-evaluation, generation, and total durations in nanoseconds;
- finish reason;
- model-requested tool names and arguments;
- whether provider-exposed thinking content was present.

Raw thinking text is deliberately not persisted. Presence is recorded as `providerExposedThinking: true`, its content as `not_captured`, and hidden reasoning remains `not_available`.

## Capability boundaries

| Capability | Support | Limitation |
|---|---:|---|
| Prompt and response | Yes | Only routed calls |
| Model metadata | Partial | Name/tag is visible; immutable digest is not guaranteed |
| Token and duration metrics | Yes | Present on final responses when supplied by Ollama |
| Tool calls | Partial | Model requests are visible; caller performs execution |
| Tool execution | No | Never inferred from a requested tool call |
| Files, terminal, resources | No | Ollama model API exposes none of these agent effects |
| Provider-exposed thinking | Partial | Presence only; raw text intentionally not persisted |
| Hidden reasoning | No | Never claimed or reconstructed |

## Security and reliability

Embedded credentials in the base URL are rejected. Request and response content flows through the collector's redaction policy before persistence. HTTP and network failures produce observable `ERROR` events. The capture branch uses a fixed byte bound to prevent unbounded provenance memory use.

The wrapper defaults to fail-closed before dispatch when initial provenance emission fails. Once an upstream response exists, capture failures are reported through the separate provenance promise so they do not corrupt the model response stream.
