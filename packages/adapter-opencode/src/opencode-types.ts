export interface OpenCodeTextPart {
  readonly id: string; readonly sessionID: string; readonly messageID: string;
  readonly type: "text"; readonly text: string; readonly synthetic?: boolean;
  readonly time?: { readonly start: number; readonly end?: number };
}
export interface OpenCodeReasoningPart {
  readonly id: string; readonly sessionID: string; readonly messageID: string;
  readonly type: "reasoning"; readonly text: string;
  readonly time: { readonly start: number; readonly end?: number };
}
export interface OpenCodeGenericPart { readonly id: string; readonly sessionID: string; readonly messageID: string; readonly type: string; readonly [key: string]: unknown }
export type OpenCodePart = OpenCodeTextPart | OpenCodeReasoningPart | OpenCodeGenericPart;

export interface OpenCodeUserMessage {
  readonly id: string; readonly sessionID: string; readonly role: "user";
  readonly time: { readonly created: number }; readonly agent: string;
  readonly model: { readonly providerID: string; readonly modelID: string };
}
export interface OpenCodeAssistantMessage {
  readonly id: string; readonly sessionID: string; readonly role: "assistant";
  readonly parentID: string;
  readonly time: { readonly created: number; readonly completed?: number };
  readonly modelID: string; readonly providerID: string; readonly mode: string;
  readonly cost: number; readonly tokens: {
    readonly input: number; readonly output: number; readonly reasoning: number;
    readonly cache: { readonly read: number; readonly write: number };
  };
  readonly error?: unknown;
}
export type OpenCodeMessage = OpenCodeUserMessage | OpenCodeAssistantMessage;

export interface OpenCodeFileDiff {
  readonly file: string; readonly before: string; readonly after: string;
  readonly additions: number; readonly deletions: number;
}

export type OpenCodeEvent =
  | { readonly type: "session.created" | "session.updated" | "session.deleted"; readonly properties: { readonly info: { readonly id: string; readonly time: { readonly created: number; readonly updated: number } } } }
  | { readonly type: "session.idle"; readonly properties: { readonly sessionID: string } }
  | { readonly type: "session.error"; readonly properties: { readonly sessionID?: string; readonly error?: unknown } }
  | { readonly type: "session.diff"; readonly properties: { readonly sessionID: string; readonly diff: readonly OpenCodeFileDiff[] } }
  | { readonly type: "message.updated"; readonly properties: { readonly info: OpenCodeMessage } }
  | { readonly type: "message.part.updated"; readonly properties: { readonly part: OpenCodePart; readonly delta?: string } }
  | { readonly type: "file.edited"; readonly properties: { readonly file: string } }
  | { readonly type: "file.watcher.updated"; readonly properties: { readonly file: string; readonly event: "add" | "change" | "unlink" } }
  | { readonly type: string; readonly properties: Readonly<Record<string, unknown>> };
