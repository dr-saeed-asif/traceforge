import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CaptureEvent } from "./prompt-store.js";

export interface JournalEvent extends CaptureEvent {
  readonly eventId: string;
  readonly occurredAt: string;
}

/** One writer per capture directory. Acknowledged events are retained for replay. */
export class EventJournal {
  public readonly runs = new Map<string, JournalEvent[]>();
  private readonly ids = new Map<string, Set<string>>();
  public constructor(private readonly directory: string) {}

  public async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const directory of await readdir(this.directory, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const path = resolve(this.directory, directory.name);
      for (const name of (await readdir(path)).filter(name => name.endsWith(".json")).sort()) {
        const event = JSON.parse(await readFile(resolve(path, name), "utf8")) as JournalEvent;
        if (!event.runId || !event.eventId || !event.eventType) throw new Error(`Invalid journal entry: ${name}`);
        this.remember(event);
      }
    }
  }

  public async append(input: CaptureEvent): Promise<void> {
    const event: JournalEvent = { ...input, eventId: input.eventId ?? randomUUID(), occurredAt: input.occurredAt ?? new Date().toISOString() };
    if (this.ids.get(event.runId)?.has(event.eventId)) return;
    const directory = resolve(this.directory, hash(event.runId));
    await mkdir(directory, { recursive: true });
    const sequence = (this.runs.get(event.runId)?.length ?? 0) + 1;
    const path = resolve(directory, `${String(sequence).padStart(12, "0")}-${hash(event.eventId)}.json`);
    await atomicWrite(path, event);
    this.remember(event);
  }

  private remember(event: JournalEvent): void {
    const ids = this.ids.get(event.runId) ?? new Set<string>();
    if (ids.has(event.eventId)) return;
    ids.add(event.eventId);
    this.ids.set(event.runId, ids);
    const events = this.runs.get(event.runId) ?? [];
    events.push(event);
    this.runs.set(event.runId, events);
  }
}

export async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flush: true, mode: 0o600 });
  await rename(temporary, path);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
