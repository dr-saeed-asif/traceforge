import type { AdapterCapability } from "@traceforge/adapter-contracts";

export const OPENCODE_CAPABILITIES: readonly AdapterCapability[] = [
  { capability: "prompt", support: "YES", evidence: "chat.message exposes the user message and parts" },
  { capability: "model_metadata", support: "YES", evidence: "user and assistant messages expose provider and model IDs" },
  { capability: "response", support: "YES", evidence: "completed text parts and assistant message metadata are observable" },
  { capability: "tool_calls", support: "YES", evidence: "tool.execute.before and tool.execute.after expose calls, inputs, and outputs" },
  { capability: "file_operations", support: "PARTIAL", evidence: "session.diff exposes byte content; write hooks do not distinguish create from overwrite" },
  { capability: "terminal_commands", support: "YES", evidence: "the documented built-in bash tool is observable through tool hooks" },
  { capability: "resources", support: "PARTIAL", evidence: "only tool arguments and outputs that explicitly expose resource identity are recorded" },
  { capability: "token_usage", support: "YES", evidence: "assistant messages and step-finish parts expose token counts" },
  { capability: "hidden_reasoning", support: "NO", evidence: "private provider reasoning is not available" },
  { capability: "visible_reasoning", support: "PARTIAL", evidence: "only explicitly emitted, user-visible reasoning parts are observable" }
] as const;
