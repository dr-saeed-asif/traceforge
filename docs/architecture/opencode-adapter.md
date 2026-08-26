# OpenCode adapter

## Audited integration surface

The adapter targets `@opencode-ai/plugin` version `1.18.21` and was reviewed on 2026-08-22 against:

- the [official plugin documentation](https://opencode.ai/docs/plugins/);
- the [official plugin hook type source](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts);
- the [official generated event and message types](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts);
- the [official built-in tool documentation](https://opencode.ai/docs/tools/).

The peer dependency is pinned exactly because hook and event names are version-sensitive. Upgrades require rerunning contract tests and reviewing the capability matrix.

## Architecture

`OpenCodeAdapter` receives official hook/event structures and emits only provider-neutral `NormalizedAgentEvent` values. `createAgentAdapterBridge` passes those values through the ordinary collector, which performs validation, redaction, ordering, idempotency, hashing, buffering, and persistence. No OpenCode SDK object enters domain or application packages.

`createTraceForgeOpenCodePlugin` returns an actual OpenCode `Plugin`. A project-local plugin can wire it to a collector:

```typescript
import { createTraceForgeOpenCodePlugin } from "@traceforge/adapter-opencode";
import { createAgentAdapterBridge } from "@traceforge/collector";

export default createTraceForgeOpenCodePlugin({
  adapterConfig: {
    contextForSession: async (openCodeSessionId) => contextRegistry.get(openCodeSessionId) ?? null,
    defaultContext: currentRunContext
  },
  eventHandler: createAgentAdapterBridge(collector, {
    name: "opencode",
    version: "1.18.21"
  })
});
```

Place that file in `.opencode/plugins/`; OpenCode officially auto-loads project plugins from that directory. The context registry is deployment-specific because OpenCode session IDs and TraceForge task/session/run IDs are separate identities.

## Capability matrix

| Capability | Support | Basis and limitation |
|---|---:|---|
| Prompt | Yes | `chat.message` exposes user message parts |
| Provider/model | Yes | User and assistant messages expose provider/model IDs |
| Response | Yes | Completed visible text parts and assistant metadata |
| Tool calls | Yes | Tool before/after hooks expose inputs and successful outputs |
| File operations | Partial | Session diffs expose before/after bytes; `write` does not say create versus overwrite |
| Terminal commands | Yes | Official `bash` tool calls are visible through tool hooks |
| Resources | Partial | Recorded only when a tool exposes an exact resource identity, such as `webfetch.url` |
| Token usage | Yes | Assistant messages expose token counters |
| Visible reasoning | Partial | Only an explicitly emitted user-visible reasoning part is captured |
| Hidden reasoning | No | Recorded as `not_available`; never reconstructed or inferred |

## Evidence semantics

Hook and bus values directly exposed by OpenCode are `OBSERVED`. A file watcher event proves that OpenCode observed a path change, but it does not identify who caused it; its actor is therefore the system and attribution is `not_available`. Session-diff content is hashed and discarded by the adapter rather than copied into event payloads.

`write` specializes to `FILE_MODIFIED` with operation `CREATE_OR_OVERWRITE`, since the hook does not expose pre-write existence. Resource records are never synthesized from tool names or unparsed output.

## Operational limitations

- The test suite compiles against the real official plugin types and exercises captured official fixtures, but this environment did not run an interactive OpenCode binary.
- Failed tool calls may require mapping from error-state message parts when the after hook is not invoked; successful before/after hooks are covered now.
- File watcher events without a session require an explicitly supplied default run context.
- SDK/plugin upgrades are not assumed compatible.
