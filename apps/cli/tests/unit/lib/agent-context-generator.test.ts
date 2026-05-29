import { describe, expect, test } from 'bun:test';
import { collectAgentContextFiles } from '@/lib/agent-context-generator';
import type { TemplateContext } from '@/types/ctx';

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'my-project', stackName: 'nextjs', libraries: ['better-auth'] }],
    project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
    git: true,
    pm: 'bun',
    ...overrides,
  };
}

describe('collectAgentContextFiles (single repo)', () => {
  test('emits a root AGENTS.md', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents).toBeDefined();
  });

  test('AGENTS.md contains the project header and the stack name', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents?.content).toContain('my-project');
    expect(agents?.content).toContain('Next.js');
  });

  test('AGENTS.md includes a section per selected addon with a fiche', () => {
    const files = collectAgentContextFiles(makeContext());
    const agents = files.find((f) => f.destination === 'AGENTS.md');
    expect(agents?.content).toContain('## Better Auth');
    expect(agents?.content).toContain('## Drizzle');
  });

  test('writes a CLAUDE.md companion that imports AGENTS.md', () => {
    const files = collectAgentContextFiles(makeContext());
    const claude = files.find((f) => f.destination === 'CLAUDE.md');
    expect(claude?.content).toBe('@AGENTS.md\n');
  });
});

describe('collectAgentContextFiles (turborepo)', () => {
  function monoContext(): TemplateContext {
    return {
      projectName: 'mysaas',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ],
      project: { database: 'postgres', orm: 'drizzle', linter: 'biome', tooling: [] },
      git: true,
      pm: 'bun',
    };
  }

  test('emits a root AGENTS.md and one per app', () => {
    const files = collectAgentContextFiles(monoContext());
    const destinations = files.map((f) => f.destination);
    expect(destinations).toContain('AGENTS.md');
    expect(destinations).toContain('apps/web/AGENTS.md');
  });

  test('app-scoped library section lands in that app file, not root', () => {
    const files = collectAgentContextFiles(monoContext());
    const web = files.find((f) => f.destination === 'apps/web/AGENTS.md');
    const root = files.find((f) => f.destination === 'AGENTS.md');
    expect(web?.content).toContain('## Better Auth');
    expect(root?.content).not.toContain('## Better Auth');
  });

  test('every AGENTS.md has a sibling CLAUDE.md import', () => {
    const files = collectAgentContextFiles(monoContext());
    expect(files.find((f) => f.destination === 'apps/web/CLAUDE.md')?.content).toBe('@AGENTS.md\n');
    expect(files.find((f) => f.destination === 'CLAUDE.md')?.content).toBe('@AGENTS.md\n');
  });

  test('apps with no fiche-bearing addon get no AGENTS.md', () => {
    const files = collectAgentContextFiles(monoContext());
    // api (hono, no libs) has no stack/lib fiche yet → no apps/api/AGENTS.md
    expect(files.some((f) => f.destination === 'apps/api/AGENTS.md')).toBe(false);
  });
});
