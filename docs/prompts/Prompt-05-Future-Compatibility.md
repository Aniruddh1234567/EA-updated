# Prompt 5 — Future compatibility

Design role and governance logic so multi-user support can be added later without breaking repository data or behavior.

## Rules

- Persist role bindings even in single-user mode.
- Avoid UI-driven identity; treat local user as implicit identity.
- Governance enforcement is global and independent of roles.
- Ensure repository metadata remains forward-compatible (owner retained in metadata).
