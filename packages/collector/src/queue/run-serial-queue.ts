import { CollectorError } from "../errors/collector-error.js";

export class RunSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private pending = 0;
  private accepting = true;

  public constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("capacity must be positive");
  }

  public enqueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) throw new CollectorError("NOT_RUNNING", "Collector queue is shutting down");
    if (this.pending >= this.capacity) throw new CollectorError("BACKPRESSURE", "Collector queue capacity exceeded");
    this.pending += 1;
    const predecessor = this.tails.get(runId) ?? Promise.resolve();
    const result = predecessor.catch(() => undefined).then(operation);
    const settled = result.then(() => undefined, () => undefined).finally(() => {
      this.pending -= 1;
      if (this.tails.get(runId) === settled) this.tails.delete(runId);
    });
    this.tails.set(runId, settled);
    return result;
  }

  public async shutdown(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled(this.tails.values());
  }

  public get pendingCount(): number { return this.pending; }
}
