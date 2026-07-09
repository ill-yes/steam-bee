# Contributing

Thanks for taking the time to improve SteamBee.

## Before You Start

- Use SteamBee only with accounts you own.
- Do not include real Steam account names, SteamIDs, refresh tokens, `.env`
  files, SQLite databases, or screenshots containing private account data.
- Public screenshots must use synthetic accounts and fake data.
- Security issues should follow [SECURITY.md](SECURITY.md), not public issue
  threads.

## Local Checks

Run these before opening a pull request:

```bash
pnpm install
pnpm format:check
pnpm check
pnpm test
docker compose config
STEAM_BEE_IMAGE=ghcr.io/ill-yes/steam-bee:test docker compose -f compose.image.yml config
```

For Docker changes, also run:

```bash
docker build --pull=false -t steam-bee:local .
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
