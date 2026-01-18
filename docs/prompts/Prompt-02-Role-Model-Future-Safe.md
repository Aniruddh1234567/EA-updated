# Prompt 2 — Role model (future-safe)

Implement the internal role model (Owner, Architect, Contributor, Viewer) even in single-user mode. Store role assignments internally using a placeholder local user identity.

## Rules

- Roles exist internally regardless of RBAC feature flag.
- Local user identity seeds the initial role bindings.
- Owner + Architect are assigned to the creating user by default.
- No owner selection is exposed in the UI.
