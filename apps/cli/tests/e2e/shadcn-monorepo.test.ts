import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type CommandResult, cleanupTempDir, createTempDir, fileExists, runCli, runCommand } from './helpers';

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
import { SidebarProvider } from '@repo/ui/components/ui/sidebar';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <SidebarProvider>
      <Card>
        <CardHeader>
          <CardTitle>Home Page</CardTitle>
        </CardHeader>
        <CardContent>Card and sidebar from the ui package</CardContent>
      </Card>
    </SidebarProvider>
  );
}
`;

const STRICT_PNPM_MAJOR = 11;
const FALLBACK_PNPM = ['env', 'pnpm_config_manage_package_manager_versions=false', 'npx', '--yes', 'pnpm@12'];

/** A `pnpm` on PATH: the installed one from pnpm 11, else `pnpm@12` fetched through npx, as install-scripts.test.ts does. */
async function pnpmEnvironment(shimDir: string): Promise<Record<string, string>> {
  const installed = Bun.which('pnpm')
    ? Number.parseInt(Bun.spawnSync(['pnpm', '--version']).stdout.toString().trim(), 10)
    : 0;
  if (installed >= STRICT_PNPM_MAJOR) return {};
  await mkdir(shimDir, { recursive: true });
  const shim = join(shimDir, 'pnpm');
  await writeFile(shim, `#!/bin/sh\nexec ${FALLBACK_PNPM.join(' ')} "$@"\n`);
  await chmod(shim, 0o755);
  return { PATH: `${shimDir}:${process.env.PATH}` };
}

const PACKAGE_MANAGERS = [
  { pm: 'bun', typecheck: ['bunx', 'tsc', '--noEmit'] },
  { pm: 'npm', typecheck: ['npx', 'tsc', '--noEmit'] },
  { pm: 'pnpm', typecheck: ['pnpm', 'exec', 'tsc', '--noEmit'] },
];

describe.each(PACKAGE_MANAGERS)('shadcn add in a turborepo under $pm', ({ pm, typecheck }) => {
  const name = `shadcn-${pm}`;
  let tempDir: string;
  let projectDir: string;
  let env: Record<string, string>;
  let addCard: CommandResult;
  let addSidebar: CommandResult;

  const run = (args: string[], cwd: string) => runCommand(args, cwd, env);

  async function documentedAddCommand(app: string): Promise<string> {
    const notes = await readFile(join(projectDir, `apps/${app}/AGENTS.md`), 'utf-8');
    const documented = notes.match(new RegExp(`\`(cd apps/${app} && [^\`]*shadcn@latest add) <name>\``));
    expect(documented, notes).not.toBeNull();
    return documented?.[1] ?? '';
  }

  beforeAll(
    async () => {
      tempDir = await createTempDir();
      env = pm === 'pnpm' ? await pnpmEnvironment(join(tempDir, 'bin')) : {};
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
      expect(result.exitCode, result.stderr).toBe(0);
      projectDir = join(tempDir, name);
      const install = await run([pm, 'install'], projectDir);
      expect(install.exitCode, install.stderr).toBe(0);

      addCard = await run(['sh', '-c', `${await documentedAddCommand('web')} card -y`], projectDir);
      addSidebar = await run(['sh', '-c', `${await documentedAddCommand('admin')} sidebar -y -o`], projectDir);

      await writeFile(join(projectDir, 'apps/web/src/app/page.tsx'), NEXT_PAGE);
      await writeFile(join(projectDir, 'apps/admin/src/routes/index.tsx'), START_ROUTE);
    },
    TIMEOUT_INSTALL + 2 * TIMEOUT_ADD + 30_000,
  );

  afterAll(async () => {
    if (tempDir) await cleanupTempDir(tempDir);
  });

  test('the documented command run from apps/web adds the component to packages/ui', async () => {
    expect(addCard.exitCode, addCard.stderr + addCard.stdout).toBe(0);
    expect(await fileExists(join(projectDir, 'packages/ui/src/components/ui/card.tsx'))).toBe(true);
    expect(await fileExists(join(projectDir, 'apps/web/src/components/ui/card.tsx'))).toBe(false);
  });

  test('the documented command run from apps/admin adds a component and its hook to packages/ui', async () => {
    expect(addSidebar.exitCode, addSidebar.stderr + addSidebar.stdout).toBe(0);
    expect(await fileExists(join(projectDir, 'packages/ui/src/components/ui/sidebar.tsx'))).toBe(true);
    expect(await fileExists(join(projectDir, 'packages/ui/src/hooks/use-mobile.ts'))).toBe(true);
    expect(await fileExists(join(projectDir, 'apps/admin/src/hooks'))).toBe(false);
    expect(await fileExists(join(projectDir, 'apps/admin/src/components/ui'))).toBe(false);
  });

  for (const dir of ['packages/ui', 'apps/web', 'apps/admin']) {
    test(
      `${dir} type-checks with the added components imported from the apps`,
      async () => {
        const result = await run(typecheck, join(projectDir, dir));
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      },
      TIMEOUT_TYPECHECK,
    );
  }

  test(
    'both apps build',
    async () => {
      const result = await run([pm, 'run', 'build'], projectDir);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    },
    TIMEOUT_BUILD,
  );
});
