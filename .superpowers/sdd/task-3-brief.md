## Task 3: Auth override (createAuth factory + admin plugin), permissions, auth-client

**Files:**
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/auth.ts.hbs`
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/permissions.ts.hbs`
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth/auth-client.ts.hbs`

**Interfaces:**
- Consumes: `Database`, better-auth tables from `@repo/db` (Task 2).
- Produces: `createAuth(db: Database)` (admin plugin + ac/roles) and `type Auth` from `@repo/auth/auth`; `ac`, `roles`, `AppRole` from `@repo/auth/permissions`; `authClient` from `@repo/auth/auth-client`. These override the structural better-auth templates.

- [ ] **Step 1: Write `permissions.ts.hbs`** — copy org-dashboard's `packages/auth/src/permissions.ts.hbs` verbatim, then change the resource statement from `contact` to `document`.

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/permissions.ts
---
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

export const statement = {
  ...defaultStatements,
  document: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

// Single source of truth for what each role may do. `roles` is built from this.
export const roleDefinitions = {
  admin: {
    ...adminAc.statements,
    document: ['create', 'read', 'update', 'delete'],
  },
  user: {
    document: ['create', 'read', 'update', 'delete'],
  },
  manager: {
    document: ['read'],
  },
} as const;

export const roles = {
  admin: ac.newRole(roleDefinitions.admin),
  user: ac.newRole(roleDefinitions.user),
  manager: ac.newRole(roleDefinitions.manager),
};

export type AppRole = keyof typeof roleDefinitions;
```

- [ ] **Step 2: Write `auth.ts.hbs`** — the structural d1 `createAuth(db)` factory (see `templates/libraries/better-auth/src/lib/auth/auth.ts.hbs`) with the admin plugin added. Concrete (turbo-only).

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/auth.ts
---
import { type Database, userAccountTable, userSessionTable, userTable, userVerificationTable } from '@repo/db';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { ac, roles } from './permissions';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const isDev = process.env.NODE_ENV === 'development';
const prodHost = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).host : undefined;

export function createAuth(db: Database) {
  return betterAuth({
    baseURL: {
      allowedHosts: [prodHost, ...(isDev ? ['localhost:*', '*.localhost:*'] : [])].filter(Boolean) as string[],
      fallback: process.env.BETTER_AUTH_URL,
      protocol: isDev ? 'http' : 'auto',
    },
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      usePlural: false,
      schema: {
        user: userTable,
        account: userAccountTable,
        session: userSessionTable,
        verification: userVerificationTable,
      },
    }),
    plugins: [admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] }), nextCookies()],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      modelName: 'user',
      fields: { name: 'username', email: 'email', emailVerified: 'emailVerified', image: 'avatarUrl', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
    session: {
      modelName: 'session',
      fields: { userId: 'userId', token: 'token', expiresAt: 'expiresAt', ipAddress: 'ipAddress', userAgent: 'userAgent', createdAt: 'createdAt', updatedAt: 'updatedAt' },
      expiresIn: 15 * DAY,
    },
    account: {
      modelName: 'account',
      fields: { userId: 'userId', accountId: 'accountId', providerId: 'providerId', accessToken: 'accessToken', refreshToken: 'refreshToken', accessTokenExpiresAt: 'accessTokenExpiresAt', refreshTokenExpiresAt: 'refreshTokenExpiresAt', scope: 'scope', idToken: 'idToken', password: 'password', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
    verification: {
      modelName: 'verification',
      fields: { identifier: 'identifier', value: 'value', expiresAt: 'expiresAt', createdAt: 'createdAt', updatedAt: 'updatedAt' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 3: Write `auth-client.ts.hbs`** — copy org-dashboard's auth-client verbatim (it is db-agnostic). Keep its dual frontmatter.

```handlebars
---
mono:
  scope: pkg
  name: auth
  path: src/auth-client.ts
path: src/lib/auth/auth-client.ts
---
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from './auth';
import { ac, roles } from './permissions';

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles }), inferAdditionalFields<Auth>()],
});
```

> Adaptation vs org-dashboard: `inferAdditionalFields<typeof auth>()` → `inferAdditionalFields<Auth>()` because d1 exports the `Auth` type (factory return), not a singleton `auth` value.

- [ ] **Step 4: Add a test** asserting the auth override carries the admin plugin and the d1 factory shape.

```ts
it('auth override uses createAuth factory + admin plugin', () => {
  const auth = readFileSync(
    join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/lib/auth/auth.ts.hbs'),
    'utf8',
  );
  expect(auth).toContain('export function createAuth(db: Database)');
  expect(auth).toContain("admin({ ac, roles, defaultRole: 'user', adminRoles: ['admin'] })");
});
```

- [ ] **Step 5: Run tests**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/auth apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack auth factory with admin plugin + RBAC"
```

---

