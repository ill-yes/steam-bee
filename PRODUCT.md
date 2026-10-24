# SteamBee Product Context

SteamBee is a self-hosted operations console for people who manage their own Steam accounts from infrastructure they control. The primary deployment targets are a small VPS and Unraid through Docker Compose. It is deliberately a single-user, single-process application: Fastify serves the React interface and coordinates Steam workers, while SQLite stores local configuration and operational history.

Playtime boosting, scheduled idling, and optional card farming are high-risk capabilities. Valve's Steam Subscriber Agreement revised April 20, 2026 expressly prohibits automation that artificially increases playtime or earns rewards or progress without genuine input. Operations, recovery, backup, observability, and safety work must not be presented as making that behavior compliant. Card farming is an explicit per-account action; it must respect operational holds and stop on conflicts, disconnection, and operator intervention.

Steam tools also cover temporary free-game offers and Steam Community inventory management. Market actions require an authenticated account, fresh ownership and pricing checks, and a separate confirmation. Appearance settings offer fixed application themes and local font stacks; users cannot upload or configure backgrounds. Achievement/statistics editing is not exposed until a supported, verifiable headless write integration exists; see [the feasibility assessment](docs/ACHIEVEMENT-EDITOR.md).

The product should feel like a quiet control plane, not a gaming launcher or a hosted SaaS landing page. Screens should favor scanning, explicit state, reliable feedback, and efficient repeated actions. Local ownership is central: credentials and runtime data stay on the operator's host, setup must be secure on a fresh installation, and backup, restore, diagnostics, updates, and reverse-proxy deployment must be understandable without hidden infrastructure.

## Product Principles

- Make current account, worker, schedule, and system state unambiguous.
- Prefer durable local behavior over features that require external services.
- Treat destructive actions, credentials, sessions, and setup as security-sensitive workflows.
- Keep the interface dense enough for operations while remaining usable at 320px and with keyboard or assistive technology.
- Use stable machine-readable API codes; localize user-facing copy in the browser.
- Preserve the single-process architecture until measured constraints justify additional services.
- Let safety controls end or pause existing activity, never initiate it.
- Yield to another Steam session without taking it over, and recover
  automatically once Steam reports the account free.
- Keep progress goals read-only and tied to explicit library snapshots; do not poll Steam or run until a target.
- Restrict group actions to safe pause, stop, and administration operations.

## Audience and Environment

The expected operator is comfortable running Docker Compose but should not need to understand SteamBee's source code. Typical installations sit behind Caddy, Nginx, Traefik, or an Unraid reverse proxy and persist `/data` in a named volume or host path. English is the canonical fallback language; other bundled locales are community translations unless separately reviewed.

## Non-Goals

- Multi-tenant or hosted account management.
- Managing accounts that the operator does not own or control.
- Marketing-led screens, gamification, social features, or decorative dashboards.
- Introducing a distributed backend, external database, or general state-management framework without a concrete operational need.
- Automatic playtime goals, one-shot autostarts, campaigns, rotation, automatic achievement unlocking, automatic free-game redemption, unattended market selling, and forced session takeover.
