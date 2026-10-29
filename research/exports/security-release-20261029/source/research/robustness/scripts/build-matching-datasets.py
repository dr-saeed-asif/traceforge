"""Matching edge cases for Def. 3 (reviewer R2-M2, E6). Trace-level synthetic sessions in
the controlled-benchmark schema; gold verdicts follow the annotation guide: a claim about a
whole command is not supported by a filtered, dry-run, or unrelated run that merely extends
or mentions it. Usage: python3 build-matching-datasets.py <out.jsonl>"""
import json, sys
NAMES = ["login", "cart", "search", "parser", "router", "cache", "auth", "upload"]
def ev(i, typ, target, **meta):
    base = {"promptId": "p", "eventId": f"e{i}", "sequenceNumber": i, "eventType": typ, "outcome": "SUCCEEDED",
            "occurredAt": f"2026-10-28T10:00:0{i}.000Z", "target": target}
    base["metadata"] = {"command": target, "executedCommand": target, "workingDirectory": ".", "toolName": "bash",
                        "exitCode": 0, "status": "SUCCEEDED", "changedPaths": [], "workspaceObservation": "complete", **meta}
    return base
def final(i, text):
    return {"promptId": "p", "eventId": f"e{i}", "sequenceNumber": i, "eventType": "FINAL_RESPONSE_CAPTURED",
            "outcome": "RECORDED", "occurredAt": f"2026-10-28T10:00:0{i}.000Z", "metadata": {"responseLength": len(text)}}
def session(fam, k, response, ctype, target, verdict, events):
    claim = {"claimIndex": 1, "claimText": response, "sourceQuote": response, "benchmarkQuote": response.rstrip("."),
             "claimType": ctype, "target": target, "expectedResult": "", "verdict": verdict, "testTampering": False,
             "captureCompleteness": "COMPLETE", "evidenceEventIds": []}
    return {"id": f"{fam}#{k}", "promptQuery": "", "finalResponse": response, "goldClaims": [claim],
            "annotationStatus": "controlled", "metadata": {"family": fam, "labelProvenance": "Synthetic trace-level matching case"}}  | {"evidence": events + [final(len(events) + 1, response)]}
rows = []
for k, n in enumerate(NAMES):
    r = "`npm test` passed."
    rows.append(session("M1_filtered_npm_test", k, r, "TEST_PASSED", "npm test", "UNSUPPORTED",
        [ev(1, "TEST_COMPLETED", f"npm test -- -t {n}", passed=3, failed=0, skipped=0)]))
    r = "`pytest` passed."
    rows.append(session("M2_selected_pytest", k, r, "TEST_PASSED", "pytest", "UNSUPPORTED",
        [ev(1, "TEST_COMPLETED", f"pytest -k {n}", passed=2, failed=0, skipped=0)]))
    r = f"`{n}.cjs` ran successfully."
    rows.append(session("M3_path_as_data", k, r, "COMMAND_SUCCEEDED", f"{n}.cjs", "UNSUPPORTED",
        [ev(1, "COMMAND_COMPLETED", f"cat {n}.cjs")]))
    r = "`npm run build` succeeded."
    rows.append(session("M4_build_dry_run", k, r, "BUILD_PASSED", "npm run build", "UNSUPPORTED",
        [ev(1, "BUILD_COMPLETED", "npm run build -- --dry-run")]))
    r = "All 12 tests passed."
    rows.append(session("M5_count_guard_control", k, r, "TEST_PASSED", "test execution", "CONTRADICTED",
        [ev(1, "TEST_COMPLETED", f"npm test -- -t {n}", passed=3, failed=0, skipped=0)]))
with open(sys.argv[1], "w") as fh:
    for s in rows: fh.write(json.dumps(s) + "\n")
print(len(rows), "sessions")
