import type { Clock, IdGenerator } from "@traceforge/application";

export type ProviderRequest = Readonly<Record<string, unknown>> & { readonly model: string; readonly stream?: boolean };
export type HeaderProvider = () => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;

export interface ProviderGatewayConfig {
  readonly baseUrl?: string;
  readonly headers?: HeaderProvider;
  readonly fetch?: typeof fetch;
  readonly maxCaptureBytes?: number;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface CapturedToolCall {
  readonly id: string | undefined;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ProviderResponseSummary {
  readonly model?: string;
  readonly responseId?: string;
  readonly responseText: string;
  readonly toolCalls: readonly CapturedToolCall[];
  readonly reasoningObserved: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly finishReason?: string;
}
