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
