import { VERIFICATION_VERDICTS, type VerificationVerdict } from "../modules/verification/domain/verdicts.js";

export interface ScoredPair { expected: VerificationVerdict | null; actual: VerificationVerdict | null }
export interface ScoredCluster { id: string; pairs: ScoredPair[] }
export function scorePairs(pairs: readonly ScoredPair[]) {
  const confusion: Record<string, number> = {};
  for (const pair of pairs) {
    const key = `${pair.expected ?? "SPURIOUS"}->${pair.actual ?? "MISSING"}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
  }
  const perVerdict = Object.fromEntries(VERIFICATION_VERDICTS.map(label => {
    const tp = pairs.filter(p => p.expected === label && p.actual === label).length;
    const fp = pairs.filter(p => p.actual === label && p.expected !== label).length;
    const fn = pairs.filter(p => p.expected === label && p.actual !== label).length;
    return [label, { truePositive: tp, falsePositive: fp, falseNegative: fn, support: tp + fn,
      precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
      f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null }];
  }));
  const gold = pairs.filter(p => p.expected !== null);
  const negativeGold = gold.filter(p => p.expected !== "VERIFIED");
  const matched = gold.filter(p => p.actual !== null);
  const f1s = Object.values(perVerdict).map(v => v.f1).filter((x): x is number => x !== null);
  return { goldClaims: gold.length, missedClaims: pairs.filter(p => p.actual === null).length,
    spuriousClaims: pairs.filter(p => p.expected === null).length,
    macroF1: f1s.length ? f1s.reduce((a,b) => a+b,0) / f1s.length : null,
    matchedAccuracy: matched.length ? matched.filter(p => p.expected === p.actual).length / matched.length : null,
    falseVerifiedRate: negativeGold.length ? negativeGold.filter(p => p.actual === "VERIFIED").length / negativeGold.length : null,
    spuriousVerifiedClaims: pairs.filter(p => p.expected === null && p.actual === "VERIFIED").length,
    accuracy: gold.length ? gold.filter(p => p.expected === p.actual).length / gold.length : null, perVerdict, confusion };
}

/** Resample whole independent clusters, never individual correlated claims. */
export function clusteredBootstrap(clusters: readonly ScoredCluster[], repetitions = 1000, seed = 42) {
  if (clusters.length < 2) return { available: false, reason: "At least two independent clusters are required.", repetitions: 0 };
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const draws: ReturnType<typeof scorePairs>[] = [];
  for (let i = 0; i < repetitions; i++) {
    const pairs = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]!.pairs).flat();
    draws.push(scorePairs(pairs));
  }
  const interval = (values: (number | null)[]) => {
    const valid = values.filter((x): x is number => x !== null).sort((a,b) => a-b);
    return valid.length ? { lower: valid[Math.floor((valid.length - 1)*0.025)]!, upper: valid[Math.ceil((valid.length - 1)*0.975)]!, validReplicates: valid.length } : null;
  };
  return { available: true, repetitions, seed, method: "cluster percentile bootstrap, 95%", accuracy: interval(draws.map(x => x.accuracy)),
    macroF1: interval(draws.map(x => x.macroF1)), matchedAccuracy: interval(draws.map(x => x.matchedAccuracy)), falseVerifiedRate: interval(draws.map(x => x.falseVerifiedRate)),
    perVerdict: Object.fromEntries(VERIFICATION_VERDICTS.map(label => [label, Object.fromEntries(["precision", "recall", "f1"].map(metric => [metric, interval(draws.map(x => x.perVerdict[label]![metric as "precision" | "recall" | "f1"]))]))])) };
}
