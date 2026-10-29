# Blockchain latency

This feature stores successful per-claim Sepolia and Sui Testnet anchor timings
in the current browser and renders a side-by-side comparison on the session
details page. Measurements are keyed by prompt ID, run ID, and claim index.

Durations exclude wallet approval. Sepolia is measured from the wallet returning
the submitted transaction hash to observing its successful receipt. Sui is
measured from submitting already-signed bytes to receiving successful execution
effects. These observed durations include RPC transport and receipt polling.
Data is local to the browser and is not uploaded to TraceForge's API or stored
on either chain. Storage version 2 keeps these measurements separate from the
old approval-inclusive timings; historical durations cannot be converted.

The comparison panel is shown for each verified claim. It shows the available
chain timings and reports the observed difference after the same claim has
successful measurements from both chains. Pending, failed, or already-existing
anchors do not create a new timing.
