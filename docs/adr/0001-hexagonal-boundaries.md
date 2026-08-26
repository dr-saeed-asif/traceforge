# ADR 0001: Hexagonal dependency boundaries

- Status: Accepted
- Date: 2026-08-22

## Context

TraceForge must integrate multiple agents, model providers, stores, transports, and optional anchoring systems without binding its provenance semantics to any one technology.

## Decision

Domain code has no dependency on providers, storage engines, frameworks, blockchains, or Node APIs. Adapters translate external representations into provider-neutral contracts. Composition occurs in executable applications. An automated test guards the domain import boundary.

## Consequences

Provider replacement and isolated domain testing remain practical. Additional mapping code is required at boundaries, and infrastructure conveniences cannot leak into domain entities.
