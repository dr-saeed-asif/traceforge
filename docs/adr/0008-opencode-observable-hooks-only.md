# ADR 0008: OpenCode observable-hooks-only adapter

- Status: Accepted
- Date: 2026-08-22

## Context

OpenCode exposes typed plugin hooks and bus events, but their fields differ in attribution and precision. Provider-private reasoning and several causal relationships are absent. Hook contracts can change between releases.

## Decision

Pin the official plugin peer dependency to `1.18.21`. Normalize only values exposed by current official hooks and generated event types. Record ambiguous write operations as `CREATE_OR_OVERWRITE`, watcher attribution as unavailable, private reasoning as `not_available`, and resources only when exact identity is present.

Compile the plugin factory against OpenCode's official `Plugin` and `Hooks` types. Keep all OpenCode imports inside the adapter package and route normalized events through the ordinary collector.

## Consequences

The adapter produces genuine OpenCode plugin hooks without leaking provider objects inward or overstating evidence. Version upgrades require source review and contract-test updates. Some file causality, failed-tool detail, response/request IDs, and provider version information remain unavailable.
