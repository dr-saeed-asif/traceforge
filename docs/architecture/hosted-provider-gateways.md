# Hosted provider gateways

`@traceforge/adapter-model-gateways` implements the provider-neutral `ModelGateway` contract for OpenAI Responses, Anthropic Messages, and DeepSeek Chat Completions. Provider profiles own URL paths and wire-format normalization; a shared gateway owns lifecycle, response cloning, capture bounds, event publication, and error behavior.

The caller supplies request bodies and headers. This keeps authentication mechanisms outside TraceForge and prevents credentials from entering normalized payloads. For Anthropic, callers must provide the currently required API key and `anthropic-version` headers. OpenAI and DeepSeek callers must provide their authorization headers.

Only traffic invoked through a gateway is observed. The upstream `Response` is returned unchanged while a clone is consumed asynchronously. Callers should await `provenance` when durable provenance completion matters.

## Normalization

Each routed call publishes `PROMPT_SUBMITTED` and `MODEL_REQUEST`, then either `MODEL_RESPONSE` or `ERROR`. Structured function/tool requests are attributes of `MODEL_RESPONSE`; they do not imply execution and never produce `TOOL_STARTED`.

Text, response IDs, model IDs, finish state, usage, and structured tool calls are captured when exposed. OpenAI reasoning events, Anthropic thinking/redacted-thinking blocks, and DeepSeek `reasoning_content` are detected only to publish `providerExposedReasoning: true`; their content is discarded before event publication. Hidden reasoning remains `not_available`.

JSON and SSE bodies are bounded by `maxCaptureBytes`. A limit failure rejects the provenance promise and publishes `ERROR` without consuming the response returned to the caller.
