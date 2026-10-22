# Contributing

Use Node.js 20 or later. The runtime must remain ESM with no runtime dependencies. Development tools are pinned in `package-lock.json`.

```sh
npm ci
git config core.hooksPath .githooks
npm run check
```

Keep changes focused and use small Conventional Commits in English, such as `fix: classify expired CLI sessions`. Explain the behavior change and the relevant test result. Update both READMEs when changing the interface, and add a changelog entry.

Test provider changes with generated fake executables or in-test loopback servers. Never use real API accounts, customer data, tokens, or private repository content in tests. Build synthetic secret fixtures by concatenation so the staged secret scanner can distinguish test source from exposed values. Test the failure case before claiming a regression is fixed. Do not weaken the gate or remove a failing assertion to make a check pass.

CLI adapters must execute without a shell, accept prompts through stdin, preserve read-only and write-mode boundaries, bound output size, and terminate children on timeout. Verify flags in official provider documentation. If a CLI version differs, provide a configurable template and document the uncertainty. Status probes must not generate text or reveal raw diagnostics.

The test suite needs child-process and local-server permissions. Report environmental failures explicitly. Passing the gate/HTTP subset alone does not establish that subprocess behavior works.

Before committing, the `.githooks/pre-commit` hook scans staged text. Never commit secrets, `.env` files, local `.llm-bridge.json` configuration, generated logs, or `is/` scratch files. Follow [SECURITY.md](SECURITY.md) for suspected vulnerabilities.

`scripts/scan-allowlist.json` contains exact public npm integrity checksums for the staged scanner. When updating dependencies, independently verify newly flagged checksums against their package metadata before updating this list. This list is not used by the runtime privacy gate. Do not add credentials or broad patterns.

## Releasing

Configure npm trusted publishing for `YusufBeratZengin/llm-bridge`, workflow `release.yml`, environment `npm`, before the first release. The workflow uses Node 24 and its bundled OIDC-capable npm; no npm token is stored in the repository or workflow. Ensure the npm package name is available and the GitHub environment permits the release.

Update CHANGELOG, bump the package and lockfile version together, run `npm run check` and `npm pack --dry-run`, and commit with `chore(release): vX.Y.Z`. The maintainer creates and pushes the matching `vX.Y.Z` tag when ready. The tag workflow checks that it matches package.json, then publishes with provenance and public access. This improvement pass does not publish or bump the version.
