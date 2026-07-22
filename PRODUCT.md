# SteamBee Product Context

SteamBee is a self-hosted operations console for people who manage their own Steam accounts from infrastructure they control. The primary deployment targets are a small VPS and Unraid through Docker Compose. It is deliberately a single-user, single-process application: Fastify serves the React interface and coordinates Steam workers, while SQLite stores local configuration and operational history.

Legacy playtime boosting and scheduled idling are a high-risk compatibility area, not a growth direction. Valve's Steam Subscriber Agreement revised April 20, 2026 expressly prohibits automation that artificially increases playtime or earns rewards or progress without genuine input. Operations, recovery, backup, observability, and safety work must not be presented as making that behavior compliant. Expanding automated goals, one-shot runs, campaigns, rotations, reward farming, or dynamic auto-presets requires a separate product-owner and legal decision.

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
- Automatic playtime goals, one-shot autostarts, campaigns, rotation, card farming, achievements, inventory or market automation, and forced session takeover.
