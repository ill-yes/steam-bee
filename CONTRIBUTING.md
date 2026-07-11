# Contributing

Thanks for taking the time to improve SteamBee.

## Before You Start

- Use SteamBee only with accounts you own.
- Security issues should follow [SECURITY.md](SECURITY.md), not public issue
  threads.

## Repository Hygiene

Never commit local runtime state, secrets, or private account data. This
includes real Steam account names, SteamIDs, refresh tokens, `.env` files,
`data/`, `backups/`, SQLite files, Steam client data, build outputs, and local
screenshots. These paths are ignored where applicable. Before committing, these
checks should be clean:

```bash
git check-ignore -v .env .env.local data apps/server/data screenshots backups
git ls-files -- data .env apps/server/data screenshots backups
```

The second command should print nothing.

Public documentation screenshots belong in `docs/screenshots/` and must use
synthetic accounts and fake data only.

## Local Checks

Run these before opening a pull request:

```bash
pnpm install
pnpm format:check
pnpm check
pnpm test
pnpm audit --audit-level=high
docker compose config
docker compose -f compose.image.yml config
pnpm compose:check
pnpm unraid:check
```

For Docker changes, also run:

```bash
docker build --pull=false -t steam-bee:local .
sh scripts/smoke-test-image.sh steam-bee:local steam-bee-local
```

## Maintainer Release Process

Development pushes and pull requests run checks but never publish a container
image. A stable release is one explicit GitHub Actions operation:

1. Open **Release**, choose **Run workflow**, and keep `main` selected.
2. Choose `patch`, `minor`, or `major` and start the workflow.

The workflow derives the next version from the latest stable GitHub Release. It
runs the quality gate, builds and scans an amd64 smoke image, and only then
creates an annotated tag on the exact validated `main` commit. It publishes the
exact version, its `major.minor` channel, and `latest` for `linux/amd64` and
`linux/arm64`, adds provenance, SBOM, and an artifact attestation, and creates
the GitHub Release with generated notes.

All releases share one queue, so two runs cannot race while updating `latest`.
If publication fails after the tag is reserved, the next run resumes that tag
and commit instead of incrementing again. Rerunning an already completed release
verifies its image and exits without creating another version. Normal pushes,
pull requests, and manually created tags never publish an image.

The publish job targets the GitHub `release` environment. Repository
administrators can optionally configure that environment with required
reviewers or other deployment protection rules; the workflow does not assume
that such rules already exist.

## Contribution Licensing

Code and other copyrightable contributions require agreement to
[CLA.md](CLA.md). Confirm the CLA checkbox in the pull request template when
submitting a contribution. The CLA keeps your copyright while granting the
project owner the rights needed to maintain both the AGPL and separate
commercial licensing paths.

The project owner may request a separately signed agreement before accepting a
substantial contribution. Contributions cannot be merged until the required
agreement is recorded.
