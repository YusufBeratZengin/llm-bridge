# Changelog

All notable changes follow [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Reproducible terminal SVG from real CLI help with a stale-image check, npm version badges, and matching English/Turkish quick starts, rationale, and FAQ.
- Native Node test coverage reporting in local and CI test runs, plus configuration validation and merge regressions.
- Weekly JavaScript/TypeScript CodeQL analysis and weekly Dependabot updates.
- Complete npm metadata, public provenance, prepublish checks and a tag-triggered trusted-publishing workflow; docs and examples included in the package.
- Safe option-specific CLI errors and synthetic-secret non-disclosure regression tables.
- Default-provider notice and gated `--dry-run` plans with status-only detection.
- Worked hypothetical stdin-provider guide tested from its exact JSON: modes, model arguments, quota/auth patterns.
- CI/license badges, real discovery/doctor/gate output and a fake-executable demo runner; synchronized English/Turkish documentation with matching sections and output details.
- PII false-positive and generated mod-97/Luhn true-positive regression tables, preserving exact-match allowlists.
- Fake-executable/HTTP fallback tests: quota, auth, deduplicated aliases, task partial-edit warning and shared `--total-timeout-ms` deadline.
- Windows shim and spaced-path tests; nested `--out` parent creation and safe write errors; Ubuntu/Windows CI on Node 20/22/24 with package checks.
- `logs --last`, `--log-dir` and `logs --clean --older-than 7d`; retention documentation and safe cleanup tests.
- Bug/feature forms, PR template, Contributor Covenant 2.1 and weekly dev-dependency/action updates.

### Changed

- Automatic test discovery replaces a fixed file list.
- Documentation commands preview plans before generation; release procedure documented without a version bump.

### Fixed

- ISBN-like numbers, UUID segments and dotted versions no longer produce phone findings; image URLs skip entropy heuristics while explicit secret detection stays active.
- Output parent directories are created and path-containing errors remain private.

## [0.1.0] - 2026-10-23

- Initial ESM CLI and Node library with no runtime dependencies.
- Codex CLI, Claude Code, local Ollama, and OpenAI-compatible HTTP adapters.
- Configurable stdin-based CLI templates for other providers.
- Ask, diff review, and explicitly authorized write-task modes.
- Pre-send secret and optional PII scanning with config-level exact allowlists.
- Error normalization, per-provider timeouts, and explicit quota/timeout fallback.
- JSON output, parseable trailers, output files, and redacted JSONL logs.
- Provider discovery, safe status probes, fake executable tests, and local HTTP tests.
- English and Turkish documentation and Ubuntu/Windows CI on Node 20 and 22.
