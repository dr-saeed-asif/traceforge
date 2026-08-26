import type { BufferedRecord, DurableBuffer } from "@traceforge/application";

export class InMemoryDurableBuffer<T> implements DurableBuffer<T> {
  private readonly records = new Map<string, BufferedRecord<T>>();

  public async put(record: BufferedRecord<T>): Promise<void> {
    this.records.set(record.recordId, structuredClone(record));
  }

  public async remove(recordId: string): Promise<void> {
    this.records.delete(recordId);
  }

  public async list(): Promise<readonly BufferedRecord<T>[]> {
    return structuredClone([...this.records.values()]);
  }
}
