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
image. A stable release is an explicit three-step operation:

1. Prepare and review the version metadata, then merge it to `main`:

   ```bash
   pnpm release:prepare 1.0.6
   pnpm release:check
   pnpm check
   pnpm test
   git diff
   ```

2. Create a version tag on that reviewed release commit and push only the tag.
   An annotated or signed tag is recommended. Pushing the tag does not publish
   anything:

   ```bash
   git tag -a v1.0.6 -m "SteamBee 1.0.6"
   git push origin v1.0.6
   ```

3. In GitHub Actions, open **Release**, choose **Run workflow**, keep `main` as
   the workflow ref, enter `1.0.6`, enable **Publish the release image to GHCR**,
   and start the workflow. The version input selects `refs/tags/v1.0.6` as the
   exact build and validation target.

The workflow rejects dispatches from refs other than `main`, versions that
differ from the tag's `package.json`, tags that are not reachable from
`origin/main`, existing GitHub Releases, and versions that are not newer than
the latest public release. The quality gate, image build, labels, and
attestation all use the exact version tag commit rather than the `main` dispatch
commit. The remote tag is checked again before the image push and GitHub Release
creation so a moved tag cannot silently change that commit. All releases share
one queue, so two versions cannot race while updating `latest`. Only this
confirmed manual run publishes the exact version, its
`major.minor` channel, and `latest`. After the image and its attestation are
published, the same run creates the GitHub Release with generated notes.
Creating a Git tag or pushing to `main` alone does not publish an image or
GitHub Release. Existing GitHub Releases are never rebuilt or overwritten.

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
