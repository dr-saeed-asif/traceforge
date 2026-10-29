import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { CaptureEvent } from "./prompt-store.js";

export interface JournalEvent extends CaptureEvent {
  readonly eventId: string;
  readonly occurredAt: string;
}

/** One writer per capture directory. Only unacknowledged events are replayed. */
export class EventJournal {
  public readonly runs = new Map<string, JournalEvent[]>();
  private readonly ids = new Map<string, Set<string>>();
  private readonly paths = new Map<string, Map<string, string>>();
  private readonly nextSequences = new Map<string, number>();
  public constructor(private readonly directory: string) {}

  public async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const directory of await readdir(this.directory, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const path = resolve(this.directory, directory.name);
      for (const name of (await readdir(path)).filter(name => name.endsWith(".json")).sort()) {
        const eventPath = resolve(path, name);
        const event = JSON.parse(await readFile(eventPath, "utf8")) as JournalEvent;
        if (!event.runId || !event.eventId || !event.eventType) throw new Error(`Invalid journal entry: ${name}`);
        this.remember(event, eventPath, sequenceFromName(name));
      }
    }
  }

  public async append(input: CaptureEvent): Promise<void> {
    const event: JournalEvent = { ...input, eventId: input.eventId ?? randomUUID(), occurredAt: input.occurredAt ?? new Date().toISOString() };
    if (this.ids.get(event.runId)?.has(event.eventId)) return;
    const directory = resolve(this.directory, hash(event.runId));
    await mkdir(directory, { recursive: true });
    const sequence = (this.nextSequences.get(event.runId) ?? 0) + 1;
    const path = resolve(directory, `${String(sequence).padStart(12, "0")}-${hash(event.eventId)}.json`);
    await atomicWrite(path, event);
    this.remember(event, path, sequence);
  }

  public async acknowledge(runId: string, count: number): Promise<void> {
    if (count <= 0) return;
    const events = this.runs.get(runId) ?? [];
    const acknowledged = events.slice(0, Math.min(count, events.length));
    if (acknowledged.length === 0) return;

    const paths = this.paths.get(runId);
    for (const event of acknowledged) {
      const source = paths?.get(event.eventId);
      if (!source) continue;
      const acknowledgedDirectory = resolve(source, "..", ".acknowledged");
      const destination = resolve(acknowledgedDirectory, basename(source));
      await mkdir(acknowledgedDirectory, { recursive: true });
      try {
        await rename(source, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await unlink(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      paths?.delete(event.eventId);
    }

    events.splice(0, acknowledged.length);
    if (events.length === 0) this.runs.delete(runId);
    if (paths?.size === 0) this.paths.delete(runId);
  }

  private remember(event: JournalEvent, path: string, sequence: number): void {
    const ids = this.ids.get(event.runId) ?? new Set<string>();
    if (ids.has(event.eventId)) return;
    ids.add(event.eventId);
    this.ids.set(event.runId, ids);
    const paths = this.paths.get(event.runId) ?? new Map<string, string>();
    paths.set(event.eventId, path);
    this.paths.set(event.runId, paths);
    this.nextSequences.set(event.runId, Math.max(this.nextSequences.get(event.runId) ?? 0, sequence));
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

function sequenceFromName(name: string): number {
  const value = Number.parseInt(name.split("-", 1)[0] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
