export interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement?: string;
}

export interface RedactionResult {
  readonly value: string;
  readonly redactionCount: number;
  readonly matchedRules: readonly string[];
}

export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
  { name: "private-key", pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/gu },
  { name: "authorization-header", pattern: /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu, replacement: "$1[REDACTED]" },
  { name: "credential-field", pattern: /((?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)\s*[:=]\s*)["']?[^\s,"';]+["']?/giu, replacement: "$1[REDACTED]" },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gu },
  { name: "github-token", pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/gu },
  { name: "database-url", pattern: /\b(?:mysql|mongodb(?:\+srv)?):\/\/[^\s]+/giu }
];

export class RedactionPolicy {
  public constructor(private readonly rules: readonly RedactionRule[] = DEFAULT_REDACTION_RULES) {}

  public redact(value: string): RedactionResult {
    let redacted = value;
    let redactionCount = 0;
    const matchedRules: string[] = [];

    for (const rule of this.rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let matches = 0;
      redacted = redacted.replace(pattern, (...args: unknown[]) => {
        matches += 1;
        if (rule.replacement === undefined) return "[REDACTED]";
        const matched = String(args[0]);
        return matched.replace(new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")), rule.replacement);
      });
      if (matches > 0) {
        redactionCount += matches;
        matchedRules.push(rule.name);
      }
    }
    return { value: redacted, redactionCount, matchedRules };
  }
}
