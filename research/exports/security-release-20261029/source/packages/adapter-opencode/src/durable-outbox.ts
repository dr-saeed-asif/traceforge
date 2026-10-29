import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Disk first, ordered delivery; unsuccessful entries survive disposal and restart. */
export class DurableOutbox<T> {
  private writes = Promise.resolve();
  private flushing: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private sequence = 0;
  private closed = false;

  public constructor(private readonly directory: string, private readonly send: (entry: T) => Promise<void>) {}

  public async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await this.flush();
  }

  public async enqueue(entry: T): Promise<void> {
    if (this.closed) throw new Error("TraceForge outbox is closed");
    const pending = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const name = `${String(Date.now()).padStart(16, "0")}-${String(this.sequence++).padStart(10, "0")}-${randomUUID()}.json`;
      const path = resolve(this.directory, name);
      await writeFile(`${path}.tmp`, JSON.stringify(entry), { encoding: "utf8", flush: true, mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.writes = pending;
    await pending;
    if (!this.timer) await this.flush();
  }

  public async flush(): Promise<void> {
    if (this.closed) return;
    if (this.flushing) {
      await this.flushing;
      if (!this.timer) await this.flush();
      return;
    }
    this.flushing = this.deliver().finally(() => { this.flushing = undefined; });
    await this.flushing;
  }

  private async deliver(): Promise<void> {
    try {
      await this.writes;
      for (const name of (await readdir(this.directory)).filter(name => name.endsWith(".json")).sort()) {
        const path = resolve(this.directory, name);
        let contents: string;
        try { contents = await readFile(path, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        await this.send(JSON.parse(contents) as T);
        await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
      this.failures = 0;
    } catch (error) {
      console.warn("[TraceForge] Delivery pending; saved events will be retried", error);
      if (!this.closed && !this.timer) {
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5));
        this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
        this.timer.unref();
      }
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.writes;
    await this.flushing;
  }
}
