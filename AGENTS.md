# ai-model-policy Canonical Agent Rules

## Purpose

Reserved couche-1 product home for Libre AI Model Policy: understand whether
a proposed use of an AI model fits an organization's rules, and why — an
explained decision, never an unexplained yes or no.
Doctrine lives upstream: https://raw.githubusercontent.com/libre-ai/project-governance/HEAD/AGENTS.md

## Domain doctrine

- Missing model facts are reported as missing, never treated as approval.
- Decisions are evaluated against an explicitly approved, pinned rule set.
- `project.v1.yaml` is the authority on project state and admission
  criteria; the README "Project status" section is generated from it —
  never edit that section by hand.
- Recovered code (`apps/model-policy`, `packages/policy-core-ref`,
  `crates/policy-core`) is not product qualification.
- Contract shapes are canonical in `libre-ai/schemas-and-contracts`, consumed
  pinned, never redefined here.

## Commands

- Prepare the pinned composition (target `ai-model-policy`):
  https://raw.githubusercontent.com/libre-ai/project-governance/HEAD/docs/LOCAL-COMPOSITION.md
- `bun run check` from this repository's root in the composition.
- Native engine: `cargo fetch --locked`, then `cargo test --locked --offline`;
  WASM checks are reported apart from native tests.

## Working here

- Security > quality > performance > completeness, in that order on conflict.
- Check real state before editing: `git status --short` and the check above;
  never hide a red test, and a skipped browser or WASM check is not a pass.
- English for code, comments and this file.
- Never commit a machine-local absolute filesystem path, a secret or a
  personal identifier.
