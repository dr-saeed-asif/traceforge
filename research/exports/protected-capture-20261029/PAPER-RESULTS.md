# Suggested manuscript additions

Add separate Table 10 rows labelled **experimental protected Linux capture, profile 3.2.0-capture.1; authenticated replay**. Retain the original vulnerable results. Do not mix these rows with baseline policy 3.1.0 / extraction 3.2.0.

Each condition contains 200 controlled sessions / 216 claims. Honest capture, forged-event attempts, full-suppression attempts and selective-suppression attempts each retain accuracy 92.59% and observed FVR 0/96. Agent-UID attempts were denied before changing authenticated evidence. Accuracy 95% session-bootstrap interval: 88.99–95.95%; family-bootstrap interval: 80–100%. The unchanged matcher still falsely rejects 16/88 sessions whose gold gate is ACCEPT; this profile does not repair that baseline limitation.

Hook-disable, missing-tail, sequence-gap and cross-session-replay faults each invalidate 200/200 sessions and reject their gates. All affected claims become Unsupported/INVALID. Accuracy falls to 25.93%, reflecting fail-safe unavailability, not successful claim verification. Each has FVR 0/96 and 88/88 false rejections among sessions whose gold gate would otherwise ACCEPT.

Across each condition, unsafe acceptance is 0/112. Supplementary two-sided 95% Clopper–Pearson upper bounds are 3.77% for FVR and 3.24% for unsafe acceptance. These binomial bounds assume independent trials; report session/family clustered intervals from the CSV alongside them. Do not pool repeated conditions as independent trials or claim that zero events establishes universal soundness.

608 real OS/control probes checked protected-file access, injection, isolated networking, host escape, explicit peer-UID rejection and restart persistence. Collector event acknowledgements: n=3,016, median 3.189 ms, p95 4.557 ms. These include socket/authentication/durable commit in controlled replay; no plugin-wide slowdown comparison was measured.

Separate live functional controls: two actual sandbox sessions / three extracted claims; created file and passing test Verified, false command success Contradicted. Initial missing-Node-runtime failures and a repeated-file control are retained in raw runs. They must not be added to the 216-claim replay denominator.

Security scope: distinct Linux UIDs, trusted administrator/host/dispatcher, all tools routed through the sandbox. The legacy Windows OpenCode integration remains unprotected. Neither Sepolia activation nor public archival has completed. Registry V2's 14 local EVM checks are engineering validation, not public-chain measurements. Do not add transaction fees, finality times, an archive DOI or a claim of credential-free Git history.
