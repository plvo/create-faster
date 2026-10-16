import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { collectInstallScripts } from '@/lib/install-scripts';
import type { TemplateContext } from '@/types/ctx';
import type { InstallScripts } from '@/types/meta';

const NEXTJS_PROJECT: TemplateContext = {
  projectName: 'app',
  repo: 'single',
  apps: [{ appName: 'app', stackName: 'nextjs', libraries: [] }],
  project: { tooling: [] },
  git: false,
  pm: 'npm',
};

function declaredInstallScripts(): InstallScripts[] {
  const addons = [
    ...Object.values(META.stacks),
    ...Object.values(META.libraries),
    ...Object.values(META.project).flatMap((category) => Object.values(category.options)),
    ...Object.values(META.blueprints),
  ] as { installScripts?: InstallScripts }[];
  return addons.flatMap((addon) => (addon.installScripts ? [addon.installScripts] : []));
}

describe('collectInstallScripts', () => {
  test('follows the selected choices', () => {
    const withDrizzle = collectInstallScripts({
      ...NEXTJS_PROJECT,
      project: { database: 'postgres', orm: 'drizzle', tooling: [] },
    });
    expect(withDrizzle).toEqual({ esbuild: false, fsevents: false });
    expect(collectInstallScripts(NEXTJS_PROJECT)).toEqual({});
  });

  test('ignores a library the stack does not support', () => {
    const scripts = collectInstallScripts({
      ...NEXTJS_PROJECT,
      apps: [{ appName: 'app', stackName: 'nextjs', libraries: ['aws-lambda'] }],
    });
    expect(scripts).toEqual({});
  });

  test('no package is allowed by one entry and denied by another, so no entry silently overrides one', () => {
    const verdicts = new Map<string, Set<boolean>>();
    for (const scripts of declaredInstallScripts()) {
      for (const [name, allowed] of Object.entries(scripts)) {
        verdicts.set(name, (verdicts.get(name) ?? new Set()).add(allowed));
      }
    }
    const conflicting = [...verdicts].filter(([, values]) => values.size > 1).map(([name]) => name);
    expect(conflicting).toEqual([]);
  });
});
