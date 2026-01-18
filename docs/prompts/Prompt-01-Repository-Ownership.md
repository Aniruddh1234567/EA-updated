# Prompt 1 — Repository ownership

On repository creation, automatically assign the current local user as Repository Owner and Architect. Do not expose owner selection in UI.

## Implementation Notes

- Owner is persisted in repository metadata at creation time.
- RBAC bindings for Owner + Architect are seeded for the creating user.
- UI does not expose owner selection during repository creation.
