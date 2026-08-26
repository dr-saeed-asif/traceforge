import type { AdapterRunContext } from "@traceforge/adapter-contracts";

export interface OllamaMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly images?: readonly string[];
  readonly tool_name?: string;
  readonly tool_calls?: readonly OllamaToolCall[];
}

export interface OllamaToolCall {
  readonly function: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
}

export interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly OllamaMessage[];
  readonly tools?: readonly unknown[];
  readonly stream?: boolean;
  readonly think?: boolean | "low" | "medium" | "high" | "max";
  readonly format?: unknown;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly keep_alive?: string | number;
}

export interface OllamaGenerateRequest {
  readonly model: string;
  readonly prompt?: string;
  readonly system?: string;
  readonly suffix?: string;
  readonly images?: readonly string[];
  readonly stream?: boolean;
  readonly think?: boolean | "low" | "medium" | "high" | "max";
  readonly raw?: boolean;
  readonly format?: unknown;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly keep_alive?: string | number;
}

export interface OllamaInvocation {
  readonly context: AdapterRunContext;
  readonly idempotencyKey?: string;
}

export interface OllamaGatewayResponse {
  readonly response: Response;
  /** Resolves after the response clone is fully captured and provenance is persisted. */
  readonly provenance: Promise<void>;
}
