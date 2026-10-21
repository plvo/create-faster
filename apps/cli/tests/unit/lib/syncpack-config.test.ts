import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectSyncpackConfig } from '@/lib/syncpack-config';
import type { TemplateContext } from '@/types/ctx';

const ctx = (apps: TemplateContext['apps']): TemplateContext => ({
  projectName: 'project',
  repo: 'turborepo',
  apps,
  project: { tooling: [] },
  git: true,
  pm: 'npm',
});

const WORKSPACE_PACKAGES = { label: 'Workspace packages', dependencies: ['$LOCAL'], isIgnored: true as const };

describe('collectSyncpackConfig', () => {
  test('ignores only the workspace packages when no stack or library pins a package', () => {
    const config = collectSyncpackConfig(
      ctx([
        { appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] },
        { appName: 'api', stackName: 'hono', libraries: [] },
      ]),
    );
    expect(config.versionGroups).toEqual([WORKSPACE_PACKAGES]);
  });

  test('ignores what the stack and the libraries of an app pin, in that app alone', () => {
    const config = collectSyncpackConfig(
      ctx([
        { appName: 'web', stackName: 'nextjs', libraries: ['shadcn'] },
        { appName: 'mobile', stackName: 'expo', libraries: ['nativewind', 'jest-expo'] },
      ]),
    );
    expect(config.versionGroups).toEqual([
      WORKSPACE_PACKAGES,
      expect.objectContaining({
        packages: ['mobile'],
        dependencies: ['react', 'react-dom', '@types/react', 'tailwindcss'],
        isIgnored: true,
      }),
    ]);
  });
});

describe('pinnedPackages in META', () => {
  const choices = [
    ...Object.entries(META.stacks).map(([name, choice]) => ({ name, choice })),
    ...Object.entries(META.libraries).map(([name, choice]) => ({ name, choice })),
  ];

  test('some choice pins a package', () => {
    expect(choices.some(({ choice }) => choice.pinnedPackages?.length)).toBe(true);
  });

  test.each(choices.filter(({ choice }) => choice.pinnedPackages?.length))(
    '$name declares a version for each package it pins',
    ({ choice }) => {
      const declared = Object.keys({
        ...choice.packageJson?.dependencies,
        ...choice.packageJson?.devDependencies,
      });
      expect(declared).toEqual(expect.arrayContaining(choice.pinnedPackages ?? []));
    },
  );
});
