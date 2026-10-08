# PostHog on TanStack Start

Research for [#174](https://github.com/plvo/create-faster/issues/174), part of map [#170](https://github.com/plvo/create-faster/issues/170).

Status: in progress.

## Question

How does PostHog integrate with TanStack Start?

- posthog-js provider setup (SSR-safe init);
- a first-party `/ingest` reverse proxy as a Start server route, on Nitro and on Workers (`@cloudflare/vite-plugin`);
- server-side capture (posthog-node, and its Workers constraints), if the Next.js library has it.

What does create-faster's `posthog` library generate for Next.js today: rewrites, provider, env vars, server capture?

## Outline

- Current create-faster wiring (Next.js)
- Answer
- posthog-js on TanStack Start
- `/ingest` reverse proxy as a server route
- Server-side capture
- Local verification (Nitro and workerd)
- Proposed META and template shape
- Open questions
