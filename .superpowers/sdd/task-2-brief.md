## Task 2: Blueprint schema override (sqlite better-auth tables + admin columns + documents)

The structural d1 schema (`schema.ts.hbs`) has the better-auth sqlite tables but **no admin-plugin columns** (`role`/`banned`/`banReason`/`banExpires`) and no `documents` table. Override the schema with a clean sqlite-only version (blueprint context is fixed to d1).

**Files:**
- Create: `apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs`
- Test: extend `apps/cli/tests/blueprints/cloudflare-fullstack.test.ts`

**Interfaces:**
- Produces: `userTable` (with `role`/`banned`/`banReason`/`banExpires`), `documentTable` (`id`, `userId`, `title`, `r2Key`, `size`, `mimeType`, `createdAt`, `updatedAt`, `expiresAt`), better-auth tables — all sqlite dialect, exported from `@repo/db`.

- [ ] **Step 1: Write the failing generation test.** Add to the existing test file a generation assertion (use the repo's generation test harness; mirror an existing blueprint generation test such as `org-dashboard`'s if present, otherwise assert the template file exists and contains the expected tables).

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('ships a sqlite schema with admin columns + documents table', () => {
  const schema = readFileSync(
    join(__dirname, '../../templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs'),
    'utf8',
  );
  expect(schema).toContain("sqliteTable('documents'");
  expect(schema).toContain("role: text('role')");
  expect(schema).toContain("banned: integer('banned'");
  expect(schema).toContain('expiresAt');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the schema override.** Concrete sqlite (no postgres/mysql conditionals). Frontmatter matches the structural schema destination (`db` pkg).

```handlebars
---
path: src/lib/db/schema.ts
mono:
  scope: pkg
  name: db
  path: src/schema.ts
---
import { relations, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timeColumns = {
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
};

export const userTable = sqliteTable('users', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  avatarUrl: text('avatar_url'),

  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),

  phone: text('phone'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  ...timeColumns,
});

export const userTableRelations = relations(userTable, ({ many }) => ({
  accounts: many(userAccountTable),
  sessions: many(userSessionTable),
  documents: many(documentTable),
}));

// https://www.better-auth.com/docs/concepts/database#session
export const userSessionTable = sqliteTable('user_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  ...timeColumns,
});

export const userSessionTableRelations = relations(userSessionTable, ({ one }) => ({
  user: one(userTable, { fields: [userSessionTable.userId], references: [userTable.id] }),
}));

// https://www.better-auth.com/docs/concepts/database#account
export const userAccountTable = sqliteTable('user_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  ...timeColumns,
});

export const userAccountTableRelations = relations(userAccountTable, ({ one }) => ({
  user: one(userTable, { fields: [userAccountTable.userId], references: [userTable.id] }),
}));

// https://www.better-auth.com/docs/concepts/database#verification
export const userVerificationTable = sqliteTable('user_verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...timeColumns,
});

export const documentTable = sqliteTable('documents', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  userId: text('user_id').notNull().references(() => userTable.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  r2Key: text('r2_key').notNull(),
  size: integer('size').notNull().default(0),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  ...timeColumns,
});

export const documentTableRelations = relations(documentTable, ({ one }) => ({
  owner: one(userTable, { fields: [documentTable.userId], references: [userTable.id] }),
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/cli && bun run vitest run tests/blueprints/cloudflare-fullstack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs apps/cli/tests/blueprints/cloudflare-fullstack.test.ts
git commit -m "feat(blueprint): cloudflare-fullstack d1 schema with admin columns + documents"
```

---

