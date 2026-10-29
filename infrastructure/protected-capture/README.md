# Protected capture profile 3.2.0-capture.1

This experimental Linux/WSL profile uses a separate collector UID (61000), trusted host (61001), and sandboxed tool UID (61002). The default Windows OpenCode plugin remains outside this protection. Do not describe it as hardened by installing these files alone.

## Trust and guarantees

The administrator, kernel, dispatcher and protected host are trusted. Agent tools run with a separate UID, chroot, mount/network namespaces, no supplementary groups, no inherited credentials and no host `/proc` or Windows mounts. The dispatcher must mediate every tool invocation and session completion. Running arbitrary tools outside it invalidates the deployment assumptions.

The collector authenticates the sender with kernel SO_PEERCRED. It commits each frame to its private SQLite ledger with synchronous FULL before acknowledging it. Monotonic sequence numbers, invocation begin/end receipts, event counts and a signed session completion bind the prompt and final response. Ed25519 completion signatures are checked against an administrator-pinned public key. No secret is placed in the tool environment.

Under these assumptions, agent tool processes cannot rewrite, delete or reorder acknowledged records, or inject accepted producer-origin frames. Missing hooks, sequence gaps, missing invocation endings and incomplete tails cause INVALID, Unsupported and gate REJECT. Collector restart persistence was tested. Administrator or trusted-host compromise is outside the guarantee. Availability is not guaranteed: broken capture rejects truthful claims too.

## Reproduction

Provision a disposable Linux host with Python 3, `cryptography`, Node, root access and free reserved UIDs. WSL Ubuntu 24.04 was used. Run from a clean checkout; output directories must be new:

```
python3 infrastructure/protected-capture/replay_attacks.py --help
node node_modules/typescript/bin/tsc -p tsconfig.json
node research/security/analyze-capture.mjs --run-dir <raw-run> --out-dir <fresh-analysis>
```

`deploy_dispatcher.py --deployment <raw-run>/deployment.json --out-dir <fresh-controls>` starts the independent supervisor and runs two actual sandbox command controls. Its dispatcher accepts bounded JSON-lines requests over a Unix socket only from UID 61001: register, execute (argv), finish (finalResponse), each with sessionId. The adapter must use this channel for all commands and finalize through the supervisor. `sandbox.host_call` demonstrates the client protocol. A native OpenCode production integration and unattended boot/service configuration remain deployment work. This is not a production Windows replacement.

Private keys and ledger are outside the checkout, under `/var/lib/traceforge-secure/`. Keep private keys there; only public PEM and signed experiment snapshots belong in archives. For local shutdown, inspect the deployment JSON, confirm the matching command lines, then stop those collector/dispatcher PIDs. PID values can change after WSL restarts.

## Evidence and limits

The eight-condition experiment replays frozen controlled traces through real OS isolation; it is not 1,600 newly performed coding tasks. The two live controls are separate. E6 matching and E7 extraction are unchanged. See the accompanying per-claim CSVs, session/family bootstrap intervals, supplementary exact binomial bounds, OS probes and latency measurements. Original vulnerable results must remain in the manuscript.
