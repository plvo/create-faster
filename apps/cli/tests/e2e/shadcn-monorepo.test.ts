import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CommandResult,
  cleanupTempDir,
  createTempDir,
  fileExists,
  PNPM_AVAILABLE,
  runCli,
  runCommand,
} from './helpers';

const TIMEOUT_INSTALL = 180_000;
const TIMEOUT_ADD = 180_000;
const TIMEOUT_TYPECHECK = 120_000;
const TIMEOUT_BUILD = 240_000;

const NEXT_PAGE = `import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/ui/card';

export default function HomePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Home Page</CardTitle>
      </CardHeader>
      <CardContent>Card from the ui package</CardContent>
    </Card>
  );
}
`;

const START_ROUTE = `import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/ui/card';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Home Page</CardTitle>
      </CardHeader>
      <CardContent>Card from the ui package</CardContent>
    </Card>
  );
}
`;

const PACKAGE_MANAGERS = [
  { pm: 'bun', typecheck: ['bunx', 'tsc', '--noEmit'], available: true },
  { pm: 'npm', typecheck: ['npx', 'tsc', '--noEmit'], available: true },
  { pm: 'pnpm', typecheck: ['pnpm', 'exec', 'tsc', '--noEmit'], available: PNPM_AVAILABLE },
];

if (!PNPM_AVAILABLE) {
  console.warn('Skipping the pnpm shadcn monorepo e2e: pnpm is not installed');
}

describe.each(PACKAGE_MANAGERS)('shadcn add in a turborepo under $pm', ({ pm, typecheck, available }) => {
  const name = `shadcn-${pm}`;
  let projectDir: string;
  let installResult: CommandResult;
  let addResult: CommandResult;

  beforeAll(
    async () => {
      if (!available) return;
      const tempDir = await createTempDir();
      const result = await runCli(
        [
          name,
          '--app',
          'web:nextjs:shadcn',
          '--app',
          'admin:tanstack-start:shadcn',
          '--no-git',
          '--no-install',
          '--pm',
          pm,
        ],
        tempDir,
      );
      expect(result.exitCode).toBe(0);
      projectDir = join(tempDir, name);
      installResult = await runCommand([pm, 'install'], projectDir);
      expect(installResult.exitCode, installResult.stderr).toBe(0);

      const notes = await readFile(join(projectDir, 'apps/web/AGENTS.md'), 'utf-8');
      const documented = notes.match(/`(cd apps\/web && [^`]*shadcn@latest add) <name>`/);
      expect(documented, notes).not.toBeNull();
      addResult = await runCommand(['sh', '-c', `${documented?.[1]} card -y`], projectDir);

      await writeFile(join(projectDir, 'apps/web/src/app/page.tsx'), NEXT_PAGE);
      await writeFile(join(projectDir, 'apps/admin/src/routes/index.tsx'), START_ROUTE);
    },
    TIMEOUT_INSTALL + TIMEOUT_ADD + 30_000,
  );

  afterAll(async () => {
    if (projectDir) await cleanupTempDir(join(projectDir, '..'));
  });

  test.skipIf(!available)('the documented command adds the component to packages/ui', async () => {
    expect(addResult.exitCode, addResult.stderr + addResult.stdout).toBe(0);
    expect(await fileExists(join(projectDir, 'packages/ui/src/components/ui/card.tsx'))).toBe(true);
    expect(await fileExists(join(projectDir, 'apps/web/src/components/ui/card.tsx'))).toBe(false);
  });

  for (const dir of ['packages/ui', 'apps/web', 'apps/admin']) {
    test.skipIf(!available)(
      `${dir} type-checks with the added component imported from the apps`,
      async () => {
        const result = await runCommand(typecheck, join(projectDir, dir));
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      },
      TIMEOUT_TYPECHECK,
    );
  }

  test.skipIf(!available)(
    'both apps build',
    async () => {
      const result = await runCommand([pm, 'run', 'build'], projectDir);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    },
    TIMEOUT_BUILD,
  );
});
