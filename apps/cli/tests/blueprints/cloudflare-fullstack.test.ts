import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('cloudflare-fullstack blueprint META', () => {
  const bp = META.blueprints['cloudflare-fullstack'];

  test('exists with the cloudflare composition', () => {
    expect(bp).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(bp!.context.project).toEqual({ database: 'd1', orm: 'drizzle', deployment: 'cloudflare' });
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    const apps = Object.fromEntries(bp!.context.apps.map((a) => [a.appName, a]));
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.web!.stackName).toBe('nextjs');
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.web!.libraries).toEqual(
      expect.arrayContaining(['shadcn', 'next-themes', 'better-auth', 'trpc', 'tanstack-query', 'tanstack-form']),
    );
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.cron!.stackName).toBe('hono');
    // biome-ignore lint/style/noNonNullAssertion: asserted on line above
    expect(apps.cron!.libraries).toEqual([]);
  });

  test('only adds blueprint-specific extras to packageJson', () => {
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated in prior test
    expect(bp!.packageJson?.dependencies).toMatchObject({ 'lucide-react': '^0.487.0', sonner: '^2.0.7', zod: '^4.2.1' });
    // biome-ignore lint/style/noNonNullAssertion: bp presence validated in prior test
    expect(bp!.rootPackageJson?.devDependencies).toMatchObject({ '@faker-js/faker': '^10.4.0' });
  });

  test('ships a sqlite schema with admin columns + documents table', () => {
    const schema = readFileSync(
      join(import.meta.dir, '../../templates/blueprints/cloudflare-fullstack/src/lib/db/schema.ts.hbs'),
      'utf8',
    );
    expect(schema).toContain("sqliteTable('documents'");
    expect(schema).toContain("role: text('role')");
    expect(schema).toContain("banned: integer('banned'");
    expect(schema).toContain('expiresAt');
  });
});
