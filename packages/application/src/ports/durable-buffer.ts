export interface BufferedRecord<T> {
  readonly recordId: string;
  readonly value: T;
}

export interface DurableBuffer<T> {
  put(record: BufferedRecord<T>): Promise<void>;
  remove(recordId: string): Promise<void>;
  list(): Promise<readonly BufferedRecord<T>[]>;
}
