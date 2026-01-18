# Prompt 20 — Final Guardrail

If an action could confuse ownership, responsibility, or semantics, block it and require explicit user confirmation.

## Rules

- No implicit defaults for lifecycle, ownership, or semantic fields.
- Require explicit user confirmation when duplicating or creating elements that could inherit semantics.
- Imports must reject missing semantic fields instead of defaulting.
