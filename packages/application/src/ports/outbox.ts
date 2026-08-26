export interface OutboxMessage<T = Readonly<Record<string, unknown>>> {
  readonly messageId: string;
  readonly topic: string;
  readonly aggregateId: string;
  readonly payload: T;
  readonly createdAt: string;
  readonly attempts: number;
}

export interface Outbox {
  claimBatch(workerId: string, limit: number, leaseMs: number): Promise<readonly OutboxMessage[]>;
  acknowledge(messageId: string, workerId: string): Promise<void>;
  release(messageId: string, workerId: string, error: string): Promise<void>;
}
