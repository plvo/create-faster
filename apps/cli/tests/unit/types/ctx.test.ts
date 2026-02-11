import { describe, expect, test } from 'bun:test';
import type { AppContext, ProjectContext, TemplateContext } from '@/types/ctx';

describe('AppContext types', () => {
  test('AppContext has libraries instead of addons', () => {
    const app: AppContext = {
      appName: 'web',
      stackName: 'nextjs',
      libraries: ['shadcn', 'tanstack-query'],
    };
    expect(app.libraries).toContain('shadcn');
  });
});

describe('ProjectContext types', () => {
  test('ProjectContext has structured fields', () => {
    const project: ProjectContext = {
      database: 'postgres',
      orm: 'drizzle',
      tooling: ['biome', 'husky'],
    };
    expect(project.database).toBe('postgres');
    expect(project.orm).toBe('drizzle');
    expect(project.tooling).toContain('biome');
  });

  test('ProjectContext database and orm are optional', () => {
    const project: ProjectContext = {
      tooling: [],
    };
    expect(project.database).toBeUndefined();
    expect(project.orm).toBeUndefined();
  });
});

describe('TemplateContext types', () => {
  test('TemplateContext has project instead of globalAddons', () => {
    const ctx: TemplateContext = {
      projectName: 'myapp',
      repo: 'single',
      apps: [{ appName: 'myapp', stackName: 'nextjs', libraries: [] }],
      project: { tooling: [] },
      git: true,
    };
    expect(ctx.project.tooling).toEqual([]);
  });
});
