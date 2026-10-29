# E4 capture-profile experiment

Additional rows for manuscript Table 10, not replacements for frozen policy 3.1.0 results. Profile 3.2.0-capture.1 enforces protected collector receipts before the unchanged deterministic rules. Evidence is replayed frozen controlled traces, not new natural OpenCode runs. Agent processes really run under a different Linux UID, in chroot + network/mount namespaces without inherited secrets, host /proc or Windows mounts. Control-plane administrator and protected host are trusted. Legacy Windows plugin/outbox is NOT hardened by this opt-in Linux deployment.

Forge/selective/full suppression are attempted at the protected OS/transport boundary, using the supplied tamper datasets. Sequence gaps, missing hooks, missing suffixes and cross-session replay are additional fault-injection cases. INVALID capture overrides affected claims to Unsupported/EVIDENCE_IS_INVALID and gate REJECT, including empty extraction. Fail-safe accuracy can fall when truthful claims are deliberately made unobservable; report availability separately.

CP intervals are supplementary iid-binomial bounds; session/family bootstrap intervals use 2000 repetitions, seed 7. Zero observed FVR is not proof of universal soundness. Counts/latencies are actual outputs. Private collector and signer keys are excluded. Sepolia deployment and public archival are separate operations, not implied by these results.

This run records the full WSL invocation and real start/end times. Linux host-path isolation has an agent-UID positive read control outside the chroot. The current verifier/extractor are policy 3.2.0 / extraction 3.3.0. Invalid capture in injected-fault cases is an expected fail-safe outcome, not malformed model output. No unexpected probe or runner failure occurred.
