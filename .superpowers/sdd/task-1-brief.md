## Task 1: META blueprint entry + generation skeleton test

**Files:**
- Modify: `apps/cli/src/__meta__.ts` (add `cloudflare-fullstack` to `META.blueprints`)
- Test: `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts` (new)

**Interfaces:**
- Produces: `META.blueprints['cloudflare-fullstack']` consumed by the generic blueprint resolver, flags (`--blueprint`), and interactive mode (all already generic — no code change).

- [ ] **Step 1: Write the failing test** — generation resolves the blueprint to the right composition.

```ts
// apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
import { describe, expect, it } from 'vitest';
import { META } from '@/__meta__';

describe('cloudflare-fullstack blueprint META', () => {
  const bp = META.blueprints['cloudflare-fullstack'];

  it('exists with the cloudflare composition', () => {
    expect(bp).toBeDefined();
    expect(bp.context.project).toEqual({ database: 'd1', orm: 'drizzle', deployment: 'cloudflare' });
    const apps = Object.fromEntries(bp.context.apps.map((a) => [a.appName, a]));
    expect(apps.web.stackName).toBe('nextjs');
    expect(apps.web.libraries).toEqual(
      expect.arrayContaining(['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form']),
    );
    expect(apps.cron.stackName).toBe('hono');
    expect(apps.cron.libraries).toEqual([]);
  });

  it('only adds blueprint-specific extras to packageJson', () => {
    expect(bp.packageJson?.dependencies).toMatchObject({ 'lucide-react': '^0.487.0', sonner: '^2.0.7', zod: '^4.2.1' });
    expect(bp.rootPackageJson?.devDependencies).toMatchObject({ '@faker-js/faker': '^10.4.0' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: FAIL — `bp` is undefined.

- [ ] **Step 3: Add the META entry.** Insert into `META.blueprints` (after `cloudflare-static-site`), mirroring `org-dashboard`'s shape.

```ts
'cloudflare-fullstack': {
  label: 'Cloudflare Fullstack',
  hint: 'Auth + RBAC dashboard with a documents CRUD on D1, R2 uploads, and a cron Worker — all on Cloudflare',
  category: 'Business',
  agentArchitecture: [
    'Fullstack Cloudflare app: a Next.js (OpenNext) web app + a Hono cron Worker (Turborepo),',
    'Better Auth with the admin plugin + access-control (admin/user/manager), tRPC for typed',
    'APIs, TanStack Query for client data, Drizzle on Cloudflare D1, and direct-binding R2',
    'uploads. The cron Worker purges expired documents (D1 rows + R2 objects) on a schedule.',
    '',
    'Per-aspect detail in `docs/agents/`:',
    '- [Auth & RBAC](docs/agents/auth-rbac.md)',
    '- [Data layer (D1 + Drizzle)](docs/agents/data-layer.md)',
    '- [Storage (R2)](docs/agents/storage.md)',
    '- [Cloudflare deploy](docs/agents/cloudflare-deploy.md)',
  ].join('\n'),
  context: {
    apps: [
      {
        appName: 'web',
        stackName: 'nextjs',
        libraries: ['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form'],
      },
      {
        appName: 'cron',
        stackName: 'hono',
        libraries: [],
      },
    ],
    project: {
      database: 'd1',
      orm: 'drizzle',
      deployment: 'cloudflare',
    },
  },
  packageJson: {
    dependencies: {
      'lucide-react': '^0.487.0',
      'react-error-boundary': '^5.0.0',
      sonner: '^2.0.7',
      zod: '^4.2.1',
    },
  },
  pkgPackageJson: {
    ui: {
      dependencies: {
        '@tanstack/react-form': '^1.23.7',
        'react-dom': '^19.2.3',
        vaul: '^1.1.2',
      },
      devDependencies: {
        '@types/react-dom': '^19.2.3',
      },
    },
  },
  rootPackageJson: {
    dependencies: {
      '@repo/auth': '*',
      '@repo/db': '*',
    },
    devDependencies: {
      '@repo/config': '*',
      '@faker-js/faker': '^10.4.0',
    },
    scripts: {
      'db:seed': 'bun --env-file=packages/db/.env scripts/seed.ts',
      start: 'turbo start',
    },
  },
  envs: [
    {
      value: 'NEXT_PUBLIC_APP_URL={{appUrl}}',
      monoScope: ['app'],
    },
  ],
},
```

> Note: `local-setup` is intentionally NOT redefined here — the `d1` option's `deploymentPackageJson.cloudflare` already provides a `local-setup` that runs `wrangler ... d1 migrations apply` then `bun run db:seed`. This blueprint only supplies the `db:seed` script that chain calls.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the META still type-checks**

Run: `cd apps/cli && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/__meta__.ts apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack META entry"
```

---

