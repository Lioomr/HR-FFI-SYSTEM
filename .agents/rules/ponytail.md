# Ponytail: minimal changes after full understanding

Inspired by [Ponytail](https://github.com/dietrichgebert/ponytail), MIT licensed. This repository-level adaptation follows Ponytail's instruction-only setup for agents that read `AGENTS.md`.

For every coding task, before editing:

1. Confirm the requested behavior needs a code change.
2. Look for an existing helper, component, API, workflow, or installed dependency to reuse.
3. Prefer standard-library and native platform features where they meet the requirement.
4. Implement only the smallest correct change, in the fewest appropriate files.
5. Fix a shared root cause when the same behavior has multiple callers; trace callers before editing.

Use Graphify for codebase discovery when its graph is available, then verify relevant behavior in source. Graphify helps find relationships; Ponytail guides the implementation size.

Do not remove validation, authorization, company scoping, error handling, audit/history, notifications, accessibility, or any behavior explicitly requested. Keep FFI's security policy, API rules, workflow engine, feature tracing, and Docker procedures authoritative. Tests and other verification must follow the active task instructions and this repository's guidance; do not add unnecessary frameworks, abstractions, boilerplate, dependencies, or tests.

When reviewing a change, look for unrequested abstractions, duplicated logic, avoidable dependencies, and code that can be removed without changing required behavior. Keep intentional simplifications correct at trust boundaries and record a known limitation when one is introduced.

Upstream project: https://github.com/dietrichgebert/ponytail
