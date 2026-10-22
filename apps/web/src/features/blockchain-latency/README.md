# Blockchain latency

This feature stores successful per-claim Sepolia and Sui Testnet anchor timings
in the current browser and renders a side-by-side comparison on the session
details page. Measurements are keyed by prompt ID, run ID, and claim index.

The current duration measures the anchor action through successful transaction
confirmation and includes wallet approval time. It is an end-to-end user
experience measurement, not a pure network-latency benchmark. Data is local to
the browser and is not uploaded to TraceForge's API or stored on either chain.

The comparison panel is shown for each verified claim. It shows the available
chain timings and reports the observed difference after the same claim has
successful measurements from both chains. Pending, failed, or already-existing
anchors do not create a new timing.
