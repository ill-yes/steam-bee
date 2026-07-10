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

## Contribution Licensing

Code and other copyrightable contributions require agreement to
[CLA.md](CLA.md). Confirm the CLA checkbox in the pull request template when
submitting a contribution. The CLA keeps your copyright while granting the
project owner the rights needed to maintain both the AGPL and separate
commercial licensing paths.

The project owner may request a separately signed agreement before accepting a
substantial contribution. Contributions cannot be merged until the required
agreement is recorded.
