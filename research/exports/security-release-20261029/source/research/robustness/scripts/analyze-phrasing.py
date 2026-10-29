"""Claim- and session-level analysis of the phrasing-variation runs.

Alignment: predicted claims whose normalized quote contains, or is contained in, the gold
quote cover it (an extractor may split one sentence into parts); their verdicts are combined
with the verifier's precedence Contradicted > Unsupported > Unverifiable > Verified. If no
quote is contained, the single best token-Dice match >= 0.5 covers it. Results are identical
for thresholds 0.3-0.8 (phrasing-ci.py). Session decisions apply
the consumer gate (claim-record.ts decideOnClaimRecord) to the predicted verdicts.
Usage: python3 analyze-phrasing.py <phrasing-dir> <out.csv>
"""
import csv, json, re, sys
from collections import Counter

P, OUT = sys.argv[1], sys.argv[2]
PREDICTION_PATTERN = sys.argv[3] if len(sys.argv) > 3 else "out-{style}-relaxed"
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

def gate(verdicts, advisory):
    if not verdicts: return "REVIEW"
    if any(v in ("CONTRADICTED", "UNSUPPORTED") for v in verdicts): return "REJECT"
    if advisory or all(v == "UNVERIFIABLE" for v in verdicts): return "REVIEW"
    return "ACCEPT"

def expected(gold):
    vs = [g["verdict"] for g in gold]
    if all(v == "VERIFIED" for v in vs): return "REVIEW" if any(g.get("testTampering") for g in gold) else "ACCEPT"
    if all(v == "UNVERIFIABLE" for v in vs): return "REVIEW"
    return "REJECT"

rows = [["style", "extractor", "gold_claims", "detected", "missed", "type_correct", "verdict_correct_detected",
         "false_verified_detected", "spurious_predicted", "spurious_verified", "sessions", "gate_agreement",
         "unsafe_accepts", "should_not_accept", "false_rejects", "should_accept"]]
for style in ["P0", "P0F", "N", "L", "S"]:
    data = {json.loads(l)["id"]: json.loads(l) for l in open(f"{P}/phrasing-{style}.jsonl")}
    preds = [json.loads(l) for l in open(f"{P}/{PREDICTION_PATTERN.format(style=style)}/predictions.jsonl")]
    for ext in ["oracle", "heuristic"]:
        c = Counter(); sessions = 0
        for r in (x for x in preds if x["extractor"] == ext):
            sessions += 1
            gold = data[r["id"]]["goldClaims"]
            claims = r["claims"]; dec = r["decisions"]
            pv = [(cl.get("sourceQuote") or cl.get("claimText") or "", cl.get("claimType"), d["verdict"],
                   "Advisory:" in json.dumps(d.get("reason", {}))) for cl, d in zip(claims, dec)]
            used = set()
            for g in gold:
                c["gold"] += 1
                gq = norm(g["sourceQuote"])
                parts = [i for i, (q, *_r) in enumerate(pv) if norm(q) and (norm(q) in gq or gq in norm(q))]
                if not parts:
                    best = max(((dice(norm(q), gq), i) for i, (q, *_r) in enumerate(pv)), default=(0, -1))
                    parts = [best[1]] if best[0] >= 0.5 else []
                if parts:
                    c["detected"] += 1; used.update(parts)
                    v = min((pv[i][2] for i in parts), key=RANK.get)
                    c["type_ok"] += any(pv[i][1] == g["claimType"] for i in parts)
                    c["verdict_ok"] += v == g["verdict"]
                    c["fv"] += v == "VERIFIED" and g["verdict"] != "VERIFIED"
                else:
                    c["missed"] += 1
            for i, (q, typ, v, a) in enumerate(pv):
                if i not in used:
                    c["spurious"] += 1; c["spurious_v"] += v == "VERIFIED"
            exp = expected(gold); got = gate([v for _q, _t, v, _a in pv], any(a for *_x, a in pv))
            c["agree"] += exp == got
            c["unsafe"] += got == "ACCEPT" and exp != "ACCEPT"; c["notacc"] += exp != "ACCEPT"
            c["frej"] += got == "REJECT" and exp == "ACCEPT"; c["acc"] += exp == "ACCEPT"
        rows.append([style, ext, c["gold"], c["detected"], c["missed"], c["type_ok"], c["verdict_ok"], c["fv"],
                     c["spurious"], c["spurious_v"], sessions, c["agree"], c["unsafe"], c["notacc"], c["frej"], c["acc"]])
csv.writer(open(OUT, "w", newline="")).writerows(rows)
for r in rows: print(" | ".join(str(x) for x in r))
