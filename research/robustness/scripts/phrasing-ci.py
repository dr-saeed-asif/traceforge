"""Session-bootstrap CIs and alignment-threshold sensitivity for the phrasing study.
Usage: python3 phrasing-ci.py <phrasing-dir>"""
import json, re, sys, random
from collections import Counter
P = sys.argv[1]
PREDICTION_PATTERN = sys.argv[2] if len(sys.argv) > 2 else "out-{style}-relaxed"
norm = lambda s: re.sub(r"\s+", " ", (s or "").lower().strip().strip(".").strip())
toks = lambda s: re.findall(r"[a-z0-9_]+", s.lower())
def dice(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb: return 0.0
    cb = Counter(tb); common = 0
    for t in ta:
        if cb[t]: common += 1; cb[t] -= 1
    return 2 * common / (len(ta) + len(tb))
def overlap(p, g):
    p, g = norm(p), norm(g)
    if p and g and (p in g or g in p): return 1.0
    return dice(p, g)
RANK = {"CONTRADICTED": 0, "UNSUPPORTED": 1, "UNVERIFIABLE": 2, "VERIFIED": 3}
def covered_verdict(pv, gq, thr):
    """Predicted claims whose quote contains or is contained in the gold quote cover it
    (an extractor may split one sentence into parts); their verdicts are combined with the
    verifier's own precedence C > S > U > V. Otherwise the single best Dice match >= thr."""
    parts = [v for q, v in pv if norm(q) and (norm(q) in norm(gq) or norm(gq) in norm(q))]
    if parts: return min(parts, key=RANK.get)
    best = max(((dice(norm(q), norm(gq)), v) for q, v in pv), default=(0, None), key=lambda x: x[0])
    return best[1] if best[0] >= thr else None
def per_session(style, ext, thr):
    data = {json.loads(l)["id"]: json.loads(l) for l in open(f"{P}/phrasing-{style}.jsonl")}
    out = []
    for r in map(json.loads, open(f"{P}/{PREDICTION_PATTERN.format(style=style)}/predictions.jsonl")):
        if r["extractor"] != ext: continue
        gold = data[r["id"]]["goldClaims"]
        pv = [((c.get("sourceQuote") or c.get("claimText") or ""), d["verdict"]) for c, d in zip(r["claims"], r["decisions"])]
        found = ok = fv = nonv = 0
        for g in gold:
            nonv += g["verdict"] != "VERIFIED"
            v = covered_verdict(pv, g["sourceQuote"], thr)
            if v is not None:
                found += 1; ok += v == g["verdict"]; fv += v == "VERIFIED" and g["verdict"] != "VERIFIED"
        out.append((len(gold), found, ok, fv, nonv))
    return out
def ci(rows, f, B=2000, seed=7):
    rnd = random.Random(seed); vals = []
    for _ in range(B):
        s = [rows[rnd.randrange(len(rows))] for _ in rows]
        num, den = f(s)
        if den: vals.append(num / den)
    vals.sort(); return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]
acc = lambda s: (sum(r[2] for r in s), sum(r[0] for r in s))
fvr = lambda s: (sum(r[3] for r in s), sum(r[4] for r in s))
for style, ext in [("P0", "heuristic"), ("S", "heuristic"), ("S", "oracle")]:
    rows = per_session(style, ext, 0.5)
    a = acc(rows); f = fvr(rows)
    print(style, ext, "acc %.1f [%.1f, %.1f]" % (100 * a[0] / a[1], *[100 * x for x in ci(rows, acc)]),
          "fvr %.1f [%.1f, %.1f]" % (100 * f[0] / f[1], *[100 * x for x in ci(rows, fvr)]))
for thr in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
    line = []
    for style in ["P0", "P0F", "N", "L", "S"]:
        rows = per_session(style, "heuristic", thr)
        line.append(f"{style}:{sum(r[1] for r in rows)}/{sum(r[2] for r in rows)}/{sum(r[3] for r in rows)}")
    print("thr", thr, " ".join(line))
