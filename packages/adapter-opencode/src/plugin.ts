import type { Hooks, Plugin } from "@opencode-ai/plugin";
import type { AgentEventHandler } from "@traceforge/adapter-contracts";
import { OpenCodeAdapter, type OpenCodeAdapterConfig } from "./opencode-adapter.js";
import type { OpenCodeEvent, OpenCodePart, OpenCodeUserMessage } from "./opencode-types.js";

export interface TraceForgeOpenCodePluginOptions {
  readonly adapterConfig: OpenCodeAdapterConfig;
  readonly eventHandler: AgentEventHandler;
}

/** Creates a genuine OpenCode Plugin using the current official hook contract. */
export function createTraceForgeOpenCodePlugin(options: TraceForgeOpenCodePluginOptions): Plugin {
  return async () => {
    const adapter = new OpenCodeAdapter();
    await adapter.initialize(options.adapterConfig);
    adapter.onEvent(options.eventHandler);
    await adapter.start();

    const hooks: Hooks = {
      dispose: () => adapter.stop(),
      event: ({ event }) => adapter.handleEvent(event as unknown as OpenCodeEvent),
      "chat.message": (input, output) => adapter.handleChatMessage(input, {
        message: output.message as unknown as OpenCodeUserMessage,
        parts: output.parts as unknown as readonly OpenCodePart[]
      }),
      "tool.execute.before": (input, output) => adapter.handleToolBefore(input, output.args),
      "tool.execute.after": (input, output) => adapter.handleToolAfter(input, output)
    };
    return hooks;
  };
}
