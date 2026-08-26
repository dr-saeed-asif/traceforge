import type { AdapterCapability } from "@traceforge/adapter-contracts";

export const OLLAMA_CAPABILITIES: readonly AdapterCapability[] = [
  { capability: "prompt", support: "YES", evidence: "Gateway observes generate prompts and routed chat messages" },
  { capability: "model_metadata", support: "PARTIAL", evidence: "API returns model name/tag but not a guaranteed immutable model digest" },
  { capability: "response", support: "YES", evidence: "Gateway observes non-streaming and NDJSON streaming response chunks" },
  { capability: "token_usage", support: "YES", evidence: "Final response includes prompt_eval_count and eval_count when available" },
  { capability: "tool_calls", support: "PARTIAL", evidence: "Model-requested tool calls are visible; execution is outside Ollama" },
  { capability: "tool_execution", support: "NO", evidence: "Ollama requests tools but does not execute caller tools" },
  { capability: "file_operations", support: "NO", evidence: "Ollama API has no agent filesystem hooks" },
  { capability: "terminal_commands", support: "NO", evidence: "Ollama API has no terminal execution hooks" },
  { capability: "resources", support: "NO", evidence: "External resource access is not exposed by the model API" },
  { capability: "hidden_reasoning", support: "NO", evidence: "No private provider reasoning is claimed" },
  { capability: "provider_exposed_thinking", support: "PARTIAL", evidence: "Presence is recorded, but raw thinking text is not persisted" }
] as const;
