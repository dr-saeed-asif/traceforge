# Sui claim anchoring UI

This feature connects Wallet Standard Sui wallets on Testnet, prepares a Move
call using the shared TraceForge claim commitment, asks the wallet to sign it,
then submits the signed bytes through the Testnet client. The displayed time
starts after signing and ends when execution returns confirmed effects. Wallet
approval is excluded. The result links to the Sui Explorer transaction page.

Before opening the wallet, the client reads the registry's dynamic-field record
for the session hash and claim index. An existing matching commitment is shown
as already anchored, with its explorer links, without submitting or recording a
new latency measurement. A conflicting immutable commitment is displayed as a
conflict. RPC failures block submission rather than being treated as an absent
record. If another tab anchors during submission, the client checks the stored
commitment again before reporting success.

Move abort code `2` in `anchor_verified_claim` means the claim key already exists.
The wallet must be set to Testnet. Wallet Standard account chain support can
advertise multiple networks and does not reliably reveal the network currently
selected in the wallet's own interface; select Testnet there if it warns that it
is on Mainnet.

After publishing `packages/sui-claim-anchoring/contracts` to Sui Testnet, set
these public object identifiers in the web environment and restart the web app:

- `NEXT_PUBLIC_SUI_ANCHOR_PACKAGE_ID`
- `NEXT_PUBLIC_SUI_ANCHOR_REGISTRY_ID`
- `NEXT_PUBLIC_SUI_ANCHOR_ADMIN_CAP_ID`

The wallet must be on Sui Testnet and own the published `AdminCap`. These IDs
are public chain object identifiers; never put wallet private keys or recovery
phrases in the environment.
