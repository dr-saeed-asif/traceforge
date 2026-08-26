import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "@traceforge/application";

export class SystemClock implements Clock {
  public now(): Date { return new Date(); }
}

export class UuidGenerator implements IdGenerator {
  public generate(): string { return randomUUID(); }
}
