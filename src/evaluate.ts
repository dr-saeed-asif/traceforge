import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  HeuristicClaimExtractor,
  OllamaClaimExtractor,
  verifyClaims,
  type ClaimExtractor,
  type ExtractedClaim,
  type VerificationEvidence,
  type VerificationVerdict,
} from "./modules/verification/index.js";

interface GoldClaim extends ExtractedClaim {
  readonly verdict: VerificationVerdict;
}

interface EvaluationCase {
  readonly id: string;
  readonly finalResponse: string;
  readonly evidence: readonly VerificationEvidence[];
  readonly goldClaims: readonly GoldClaim[];
}

const options = argumentsFor(process.argv.slice(2));
const extractor = createExtractor(options.extractor, process.env);
const cases = await readJsonLines(options.dataset);
let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
let verdictCorrect = 0;
let verdictEvaluated = 0;
const confusion: Record<string, number> = {};
let totalLatencyMs = 0;
const usage: Record<string, number> = {};

for (const item of cases) {
  const request = {
    finalResponse: item.finalResponse,
    modelName: "evaluation",
  };
  const startedAt = Date.now();
  const detailed = extractor.extractDetailed
    ? await extractor.extractDetailed(request)
    : undefined;
  const predicted = detailed?.claims ?? (await extractor.extract(request));
  totalLatencyMs +=
    typeof detailed?.metadata.latencyMs === "number"
      ? detailed.metadata.latencyMs
      : Date.now() - startedAt;
  addUsage(usage, detailed?.metadata.usage);
  const matches = matchClaims(predicted, item.goldClaims);
  truePositive += matches.length;
  falsePositive += predicted.length - matches.length;
  falseNegative += item.goldClaims.length - matches.length;
  const promptId = item.evidence[0]?.promptId;
  const verdicts = verifyClaims(
    predicted,
    item.evidence,
    promptId ? { promptId } : {},
  );
  for (const match of matches) {
    const actual = verdicts[match.predictedIndex]?.verdict;
    const expected = item.goldClaims[match.goldIndex]?.verdict;
    if (!actual || !expected) continue;
    verdictEvaluated++;
    if (actual === expected) verdictCorrect++;
    confusion[`${expected}->${actual}`] =
      (confusion[`${expected}->${actual}`] ?? 0) + 1;
  }
}

const precision = ratio(truePositive, truePositive + falsePositive);
const recall = ratio(truePositive, truePositive + falseNegative);
process.stdout.write(
  `${JSON.stringify(
    {
      dataset: options.dataset,
      extractor: extractor.modelName ?? options.extractor,
      cases: cases.length,
      runtime: {
        totalLatencyMs,
        meanLatencyMs:
          cases.length === 0 ? 0 : Math.round(totalLatencyMs / cases.length),
        usage,
      },
      extraction: {
        truePositive,
        falsePositive,
        falseNegative,
        precision,
        recall,
        f1:
          precision + recall === 0
            ? 0
            : round((2 * precision * recall) / (precision + recall)),
      },
      verdicts: {
        evaluated: verdictEvaluated,
        correct: verdictCorrect,
        accuracy: ratio(verdictCorrect, verdictEvaluated),
        confusion,
      },
    },
    null,
    2,
  )}\n`,
);

function createExtractor(
  name: string,
  environment: NodeJS.ProcessEnv,
): ClaimExtractor {
  if (name === "heuristic") return new HeuristicClaimExtractor();
  if (name !== "ollama") throw new Error("--extractor must be heuristic or ollama");
  return new OllamaClaimExtractor({
    endpoint: environment.TRACEFORGE_LLM_ENDPOINT ?? "http://127.0.0.1:11434/api/chat",
    model: environment.TRACEFORGE_LLM_MODEL ?? "qwen3.5:4b",
    timeoutMs: Number(environment.TRACEFORGE_LLM_TIMEOUT_MS ?? "180000"),
  });
}

async function readJsonLines(path: string): Promise<EvaluationCase[]> {
  const rows: EvaluationCase[] = [];
  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const value = JSON.parse(line) as EvaluationCase;
    if (
      !value.id ||
      !value.finalResponse ||
      !Array.isArray(value.goldClaims) ||
      !Array.isArray(value.evidence)
    )
      throw new TypeError(`Invalid evaluation row: ${line.slice(0, 80)}`);
    rows.push(value);
  }
  return rows;
}

function matchClaims(
  predicted: readonly ExtractedClaim[],
  gold: readonly GoldClaim[],
) {
  const used = new Set<number>();
  const matches: Array<{ predictedIndex: number; goldIndex: number }> = [];
  predicted.forEach((claim, predictedIndex) => {
    const quote = normalize(claim.sourceQuote ?? claim.claimText);
    const goldIndex = gold.findIndex(
      (candidate, index) =>
        !used.has(index) &&
        candidate.claimType === claim.claimType &&
        normalize(candidate.sourceQuote ?? candidate.claimText) === quote,
    );
    if (goldIndex >= 0) {
      used.add(goldIndex);
      matches.push({ predictedIndex, goldIndex });
    }
  });
  return matches;
}

function argumentsFor(values: readonly string[]) {
  const datasetIndex = values.indexOf("--dataset");
  const extractorIndex = values.indexOf("--extractor");
  return {
    dataset:
      datasetIndex >= 0
        ? required(values[datasetIndex + 1], "--dataset")
        : (values[0] ?? "research/evaluation.example.jsonl"),
    extractor:
      extractorIndex >= 0
        ? required(values[extractorIndex + 1], "--extractor")
        : (values[1] ?? "heuristic"),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}
function addUsage(total: Record<string, number>, value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  for (const [key, count] of Object.entries(value))
    if (typeof count === "number") total[key] = (total[key] ?? 0) + count;
}
function ratio(value: number, total: number): number {
  return total === 0 ? 0 : round(value / total);
}
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
