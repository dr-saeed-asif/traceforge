# Sui claim anchoring UI

This feature connects Wallet Standard Sui wallets on Testnet, prepares a Move
call using the shared TraceForge claim commitment, submits it through the wallet,
and links to the Sui Explorer transaction page. The displayed elapsed time
covers wallet approval and Sui execution together.

After publishing `packages/sui-claim-anchoring/contracts` to Sui Testnet, set
these public object identifiers in the web environment and restart the web app:

- `NEXT_PUBLIC_SUI_ANCHOR_PACKAGE_ID`
- `NEXT_PUBLIC_SUI_ANCHOR_REGISTRY_ID`
- `NEXT_PUBLIC_SUI_ANCHOR_ADMIN_CAP_ID`

The wallet must be on Sui Testnet and own the published `AdminCap`. These IDs
are public chain object identifiers; never put wallet private keys or recovery
phrases in the environment.
