import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

/**
 * The runtime of Cloudflare refuses a PBKDF2 derivation above 100,000 iterations, and open-source workerd (so Miniflare,
 * `wrangler dev`, `opennextjs-cloudflare preview` and the e2e tests) accepts any count: nothing run on a developer's
 * machine shows that a Payload release cannot sign in on a deployed Worker. This test is the gate until one can.
 * payloadcms/payload#18274 tracks it; payloadcms/payload#18461 adds an option to set the count.
 *
 * Each release lists the iteration count of `generatePasswordSaltHash.js` in its published package (`dist/auth/strategies/local`):
 * `currentPasswordHashIterations` since 3.90.0, the 25,000 of `crypto.pbkdf2` before. Add a release after reading that file.
 */
const CLOUDFLARE_PBKDF2_LIMIT = 100_000;

const HASH_ITERATIONS_BY_RELEASE: Record<string, number> = {
  '3.89.0': 25_000,
  '3.90.0': 600_000,
  '3.90.1': 600_000,
  '3.90.2': 600_000,
  '3.91.0': 600_000,
};

const pinnedPayload = (): string => {
  const web = META.blueprints['cloudflare-payload-nextjs']?.context.apps.find((app) => app.appName === 'web');
  const version = web?.packageJson?.dependencies?.payload;
  if (typeof version !== 'string') throw new Error('the web app of cloudflare-payload-nextjs does not depend on payload');
  return version;
};

describe('the Payload release pinned by cloudflare-payload-nextjs', () => {
  test('is a release whose password hashes Cloudflare can verify', () => {
    const version = pinnedPayload();
    const iterations = HASH_ITERATIONS_BY_RELEASE[version];

    expect(
      iterations,
      `Payload ${version} is not in the table: read generatePasswordSaltHash.js in its package and add its iteration count`,
    ).toBeDefined();
    expect(
      iterations,
      `Payload ${version} hashes passwords with ${iterations} PBKDF2 iterations and Cloudflare refuses more than ${CLOUDFLARE_PBKDF2_LIMIT}, so nobody can sign in or create the first admin on a deployed Worker (payloadcms/payload#18274). Pin a release that fixes it, or set an iteration count of ${CLOUDFLARE_PBKDF2_LIMIT} or less through the option payloadcms/payload#18461 adds.`,
    ).toBeLessThanOrEqual(CLOUDFLARE_PBKDF2_LIMIT);
  });
});
