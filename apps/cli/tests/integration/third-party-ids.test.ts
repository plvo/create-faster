import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

interface ThirdPartyCase {
  title: string;
  args: string[];
  project: string;
  envFiles: string[];
  variables: string[];
  source: string;
  withoutIt: RegExp;
}

const THIRD_PARTY_CASES: ThirdPartyCase[] = [
  {
    title: 'PostHog on a Next.js app',
    args: ['--app', 'web:nextjs:posthog'],
    project: 'ids-posthog-next',
    envFiles: ['.env.example'],
    variables: ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'],
    source: 'us.posthog.com',
    withoutIt: /analytics stay off/,
  },
  {
    title: 'PostHog on a TanStack Start app',
    args: ['--app', 'web:tanstack-start:posthog'],
    project: 'ids-posthog-start',
    envFiles: ['.env.example'],
    variables: ['VITE_POSTHOG_PROJECT_TOKEN'],
    source: 'us.posthog.com',
    withoutIt: /analytics stay off/,
  },
  {
    title: 'PostHog in a turborepo',
    args: ['--app', 'web:nextjs:posthog', '--app', 'api:hono'],
    project: 'ids-posthog-mono',
    envFiles: ['apps/web/.env.example'],
    variables: ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'],
    source: 'us.posthog.com',
    withoutIt: /analytics stay off/,
  },
  {
    title: 'the showcase blueprint',
    args: ['--blueprint', 'showcase-nextjs'],
    project: 'ids-showcase',
    envFiles: ['.env.example'],
    variables: ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'],
    source: 'us.posthog.com',
    withoutIt: /analytics stay off/,
  },
  {
    title: 'the Privy dApp blueprint',
    args: ['--blueprint', 'dapp-privy-nextjs'],
    project: 'ids-privy',
    envFiles: ['.env.example'],
    variables: ['NEXT_PUBLIC_PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_CLIENT_ID', 'PRIVY_APP_SECRET'],
    source: 'dashboard.privy.io',
    withoutIt: /shows a setup message/,
  },
  {
    title: 'the RainbowKit dApp blueprint',
    args: ['--blueprint', 'dapp-rainbowkit-nextjs'],
    project: 'ids-rainbowkit',
    envFiles: ['.env.example'],
    variables: ['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'],
    source: 'dashboard.reown.com',
    withoutIt: /shows a setup message/,
  },
];

function valueOf(env: string, variable: string): string | undefined {
  const line = env.split('\n').find((candidate) => candidate.startsWith(`${variable}=`));
  return line?.slice(variable.length + 1).replace(/\s+#.*$/, '').trim();
}

describe('third-party ids', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const { args, project } of THIRD_PARTY_CASES) {
      const result = await runCli([project, ...args, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  for (const { title, project, envFiles, variables } of THIRD_PARTY_CASES) {
    test(`${title} commits blank ids, so a copied .env never activates a client`, async () => {
      for (const envFile of envFiles) {
        const env = await readTextFile(join(tempDir, project, envFile));
        for (const variable of variables) {
          expect(valueOf(env, variable), `${variable} in ${envFile}`).toBe('');
        }
      }
    });
  }

  for (const { title, project, variables, source, withoutIt } of THIRD_PARTY_CASES) {
    test(`${title} tells in its README where each id comes from and what the app does without it`, async () => {
      const readme = await readTextFile(join(tempDir, project, 'README.md'));
      for (const variable of variables) {
        expect(readme).toContain(variable);
      }
      expect(readme).toContain(source);
      expect(readme).toMatch(withoutIt);
    });
  }

  for (const { title, project, variables, source, withoutIt } of THIRD_PARTY_CASES) {
    test(`${title} tells in its AGENTS.md where each id comes from and what the app does without it`, async () => {
      const agents = await readTextFile(join(tempDir, project, 'AGENTS.md'));
      for (const variable of variables) {
        expect(agents).toContain(variable);
      }
      expect(agents).toContain(source);
      expect(agents).toMatch(withoutIt);
    });
  }

  test('a project with none of these services has no third-party section', async () => {
    const result = await runCli(
      ['ids-plain', '--app', 'web:nextjs:shadcn', '--no-git', '--no-install', '--pm', 'bun'],
      tempDir,
    );
    expect(result.exitCode, result.stderr).toBe(0);
    for (const file of ['README.md', 'AGENTS.md']) {
      expect(await readTextFile(join(tempDir, 'ids-plain', file))).not.toContain('Third-party ids');
    }
  });
});

describe('dApp blueprints without an id', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of ['dapp-privy-nextjs', 'dapp-rainbowkit-nextjs']) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  test('dapp-privy-nextjs shows a setup message and mounts no Privy provider while the app id is blank', async () => {
    const providers = await readTextFile(join(tempDir, 'dapp-privy-nextjs/src/components/app-providers.tsx'));
    const guard = providers.indexOf('NEXT_PUBLIC_PRIVY_APP_ID');
    expect(guard).toBeGreaterThan(-1);
    expect(providers.slice(guard)).toMatch(/if \(!privyAppId\) return <MissingConfig/);
    expect(providers).not.toMatch(/throw new Error/);

    const message = await readTextFile(join(tempDir, 'dapp-privy-nextjs/src/components/missing-config.tsx'));
    expect(message).toContain('NEXT_PUBLIC_PRIVY_APP_ID');
    expect(message).toContain('https://dashboard.privy.io');
  });

  test('dapp-privy-nextjs builds the Privy server client when a request carries a token, not at import', async () => {
    const init = await readTextFile(join(tempDir, 'dapp-privy-nextjs/src/trpc/init.ts'));
    expect(init).not.toMatch(/^const privy = new PrivyClient/m);
    expect(init).not.toMatch(/^if \(!privy\w+\) throw/m);
  });

  test('dapp-rainbowkit-nextjs shows a setup message and builds no wallet config while the project id is blank', async () => {
    const wagmi = await readTextFile(join(tempDir, 'dapp-rainbowkit-nextjs/src/lib/wagmi.ts'));
    expect(wagmi).not.toMatch(/throw new Error/);
    expect(wagmi).toMatch(/projectId\s*\?\s*getDefaultConfig/);

    const providers = await readTextFile(join(tempDir, 'dapp-rainbowkit-nextjs/src/components/app-providers.tsx'));
    expect(providers).toMatch(/if \(!wagmiConfig\) return <MissingConfig/);

    const message = await readTextFile(join(tempDir, 'dapp-rainbowkit-nextjs/src/components/missing-config.tsx'));
    expect(message).toContain('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
    expect(message).toContain('https://dashboard.reown.com');
  });
});
