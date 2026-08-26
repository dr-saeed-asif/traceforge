import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BufferedRecord, DurableBuffer } from "@traceforge/application";

function assertSafeRecordId(recordId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(recordId)) throw new TypeError("Unsafe durable-buffer record ID");
}

export class FileDurableBuffer<T> implements DurableBuffer<T> {
  public constructor(private readonly directory: string) {}

  public async put(record: BufferedRecord<T>): Promise<void> {
    assertSafeRecordId(record.recordId);
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${record.recordId}.json`);
    const temporary = join(this.directory, `${record.recordId}.tmp`);
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  }

  public async remove(recordId: string): Promise<void> {
    assertSafeRecordId(recordId);
    try { await unlink(join(this.directory, `${recordId}.json`)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  public async list(): Promise<readonly BufferedRecord<T>[]> {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => {
      const parsed = JSON.parse(await readFile(join(this.directory, name), "utf8")) as BufferedRecord<T>;
      assertSafeRecordId(parsed.recordId);
      return parsed;
    }));
  }
}
