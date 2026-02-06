# Programmatic .env.example Generation

## Problem

Environment variable templates (`.env.example.hbs`) are scattered across template directories, duplicated between ORMs, and hard to maintain. The `databaseUrl` Handlebars helper encodes connection string logic that belongs in META.

## Solution

Declare env vars in `__meta__.ts` per addon (same pattern as `packageJson`), collect them programmatically, and generate `.env.example` files at the correct monorepo locations.

## Type Changes

### `types/meta.ts`

```ts
type EnvScope = 'app' | 'root' | { pkg: string };

interface EnvVar {
  value: string;          // full .env line: KEY=value # comment
  monoScope: EnvScope[];  // where to write .env.example
}
```

`EnvScope` uses an explicit `{ pkg: string }` for package scope because the addon declaring the env var may not own the target package (e.g. `postgres` declares `DATABASE_URL` which goes to the ORM's `packages/db/`).

Add `envs?: EnvVar[]` to `MetaAddon`.

## META Changes

### `__meta__.ts`

```ts
postgres: {
  // ... existing
  envs: [
    { value: 'DATABASE_URL="postgresql://postgres:password@localhost:5432/{{projectName}}" # Local Docker PostgreSQL', monoScope: [{ pkg: 'db' }, 'app'] }
  ]
}

mysql: {
  // ... existing
  envs: [
    { value: 'DATABASE_URL="mysql://mysql:password@localhost:3306/{{projectName}}" # Local Docker MySQL', monoScope: [{ pkg: 'db' }, 'app'] }
  ]
}

'better-auth': {
  // ... existing
  envs: [
    { value: 'BETTER_AUTH_SECRET= # generate with: openssl rand -base64 32', monoScope: [{ pkg: 'auth' }, 'app'] },
    { value: 'BETTER_AUTH_URL=http://localhost:{{appPort}}', monoScope: ['app'] }
  ]
}
```

No other addons need env vars (confirmed via Context7 audit of all libraries).

## Scope Resolution

- `{ pkg: 'db' }` → `packages/db/.env.example`
- `{ pkg: 'auth' }` → `packages/auth/.env.example`
- `'app'` → `apps/{appName}/.env.example`
  - Library envs: only apps that have that library selected
  - Project addon envs: all apps
- `'root'` → `.env.example` at project root

**Single repos**: all scopes collapse to root `.env.example`, deduped by key (split on `=`).

**Turborepo does NOT load .env files** — each framework loads its own:
- Next.js loads from its app directory (`apps/web/.env`)
- Prisma/Drizzle use `dotenv/config` from their package directory
- This is why we need per-location `.env.example` files, not just root

## New File: `lib/env-generator.ts`

Responsibilities:

1. **Collect**: Walk all selected addons (project categories + libraries), collect `envs`
2. **Group**: Group by resolved destination path based on `monoScope`
3. **Template**: Process `{{projectName}}` and `{{appPort}}` through Handlebars
4. **Dedupe**: Same key (split on `=`) from multiple addons → keep first occurrence
5. **Return**: `TemplateFile[]` — same shape as template-resolver output, plugs into `file-writer.ts`
6. **Context**: Also produce `envGroups` data for README template rendering

Integration: called in `file-generator.ts` alongside template resolution and package-json generation.

## README Integration

Add `envGroups` to template context before rendering:

```ts
envGroups: [
  { path: 'packages/db/.env', vars: ['DATABASE_URL'] },
  { path: 'apps/web/.env', vars: ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'] }
]
```

Add to both `repo/single/README.md.hbs` and `repo/turborepo/README.md.hbs`:

```handlebars
{{#if envGroups.length}}
## Environment Variables

Copy each `.env.example` to `.env` and configure:

{{#each envGroups}}
### `{{path}}`
{{#each vars}}
- `{{this}}`
{{/each}}

{{/each}}
{{/if}}
```

Update existing `cp .env.example .env` instructions to reference actual locations.

## Cleanup

- Delete `templates/stack/nextjs/__env.example.hbs`
- Delete `templates/project/orm/drizzle/__env.example.hbs`
- Delete `templates/project/orm/prisma/__env.example.hbs`
- Remove `databaseUrl` Handlebars helper from `lib/handlebars.ts`

## Implementation Order

1. Add `EnvVar` type and `EnvScope` type to `types/meta.ts`
2. Add `envs` to META entries in `__meta__.ts`
3. Create `lib/env-generator.ts` (collect, group, template, return files)
4. Integrate into `file-generator.ts`
5. Update README templates with env section
6. Delete old `.env.example.hbs` templates
7. Remove `databaseUrl` Handlebars helper
8. Update tests
