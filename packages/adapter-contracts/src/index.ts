import type { EventActor, EvidenceLevel, ProvenanceEventType } from "@traceforge/domain";

export interface AdapterRunContext {
  readonly taskId: string;
  readonly sessionId: string;
  readonly runId: string;
}

export interface NormalizedAgentEvent extends AdapterRunContext {
  readonly eventType: ProvenanceEventType;
  readonly actor: EventActor;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt?: string;
  readonly provider?: string;
  readonly providerEventId: string;
  readonly evidence: EvidenceLevel;
}

export type AgentEventHandler = (event: NormalizedAgentEvent) => Promise<void>;
export type Unsubscribe = () => void;

export interface AdapterCapability {
  readonly capability: string;
  readonly support: "YES" | "PARTIAL" | "NO";
  readonly evidence: string;
}

export interface AgentAdapter<TConfig> {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly AdapterCapability[];
  initialize(config: TConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: AgentEventHandler): Unsubscribe;
}

export interface ModelGatewayInvocation {
  readonly context: AdapterRunContext;
  readonly idempotencyKey?: string;
}

export interface ModelGatewayResult {
  readonly response: Response;
  /** Resolves when the cloned provider response has been normalized and published. */
  readonly provenance: Promise<void>;
}

export interface ModelGateway<TRequest = Readonly<Record<string, unknown>>> {
  invoke(request: TRequest, invocation: ModelGatewayInvocation): Promise<ModelGatewayResult>;
}
