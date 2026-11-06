# Central Knot agent instructions

## Non-negotiable product boundary

Central Knot is a configuration mover, not a secret manager or security product. Managing secrets is the user's responsibility.

- This applies to MCP configurations, skills, agent definitions, instructions and all other managed content.
- Do not search for or classify secrets, scan content, redact or filter values, omit content because it contains a secret, introduce vault integration, or add secret-specific warnings or approval prompts.
- Preserve content and values as-is through supported format translation, synchronization, local storage, history and restoration. Embedded credentials are ordinary configuration values for this product.
- Do not propose secret-management features as requirements, implementation work, acceptance criteria or review findings. Validate configuration syntax and supported formats without inspecting content for secrets.

## Mandatory subagent briefing

Every delegated task must include the following paragraph directly in its task brief, whether it concerns research, specification writing, implementation, builds, testing or review. Do not rely on inherited conversation context or the child discovering this file.

> Central Knot is a configuration mover, not a secret manager. Managing secrets is the USER's responsibility. Do not look for secrets in MCP configurations, skills, agents, instructions or other content. Do not add secret scanning, classification, redaction, filtering, omission, vaults, or secret-specific warnings/approvals. Preserve configuration content and values as-is, including embedded secrets, through supported translation, sync, storage, history and restoration. Do not treat the absence of secret-management features as a defect.

If a subagent is authorized to delegate further, it must include the same paragraph in every downstream task brief. This instruction does not itself authorize delegation.
