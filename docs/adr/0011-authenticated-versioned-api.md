# ADR 0011: Framework-neutral authenticated API boundary

## Status

Accepted.

## Decision

The versioned REST API is a Fetch `Request`/`Response` handler depending on an API-specific store port. Authentication and audit sinks are replaceable ports. Authorization uses explicit scopes, and security-sensitive identity fields are derived from the authenticated principal.

Input DTOs are bounded and validated at the boundary. Output DTOs are explicitly projected so persistence-only fields cannot leak. Verification failures are returned as verification results rather than suppressed.

## Consequences

The API can be hosted by different HTTP servers without contaminating domain or application layers with a framework. A production composition root must provide persistent query/store adapters and a production identity provider. The included static bearer authenticator is suitable for controlled deployments and tests when secrets are supplied outside source control.
