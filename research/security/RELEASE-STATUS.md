# Security revision status — 29 October 2026

Implemented and locally tested: optional protected Linux collector and independent sandbox dispatcher; signed complete-session validation and fail-closed gate wrapper; Registry V2 with separate rotatable signer, epochs, permanently blocked historical signer and low-s signatures; refusal of the historical compromised signer in the existing web signing helper.

148 repository tests passed. Registry V2 passed 14 real local Ganache EVM checks, using ephemeral keys. Ganache used its JavaScript transport fallback because the native Windows uWS binary was unavailable. These are not Sepolia transaction measurements.

A replacement signer was generated in a root-only WSL vault. Public address: `0x8A48491C722ACC46066504bB0613A00B6d071847`. This is generation, not completed on-chain rotation. The old compromised public address is `0xC5D9e40Aa244e30d7C0953D1Ecd76B7c42c31d26`.

The new Sepolia transaction is prepared for owner `0x80949bf40bB69ba00Ac21562e7bE2e82450d1919` in `deployment-20261029-final/unsigned-sepolia-deployment.json`. RPC preflight succeeded and estimated 4,646,695 gas. No wallet signature, broadcast transaction, deployed address, receipt, fee or confirmation time exists for this revision. Review/sign the transaction in that wallet, verify the deployed runtime/constructor owner and signer, then deliberately configure a V2-aware authorization service using the isolated vault. The current V1 web authorization flow must not be pointed at V2: its EIP-712 version/epoch differs. Public activation remains blocked.

The provided Sui address is a public account, not deployment credentials. No Sui deployment or measurement was performed.

Historical credentials remain in the existing Git history. A clean source snapshot can exclude them but does not erase shared history. Do not claim that history is credential-free. Coordinated history remediation and remote credential revocation remain required. Existing GitHub credentials returned HTTP 401; no authenticated release push was possible. No Zenodo account/token was provided and no DOI was issued. A prepared archive is not a published release. Publish the reviewed sanitized source/results archive from an authorized account and record its actual DOI and immutable release commit before replacing manuscript placeholders.

No retained 28 October live-probe traces were found in the local database examined; it contained 40 sessions / 399 events ending 23 October. This does not establish absence from remote deployments.

Keep original policy 3.1.0 / extraction 3.2.0 rows. Add profile 3.2.0-capture.1 as a separate authenticated-replay experiment, not as a replacement or a measured production security guarantee.
