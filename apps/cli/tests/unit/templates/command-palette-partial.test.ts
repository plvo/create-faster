import { beforeAll, describe, expect, test } from 'bun:test';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { StackName } from '@/types/stack-name';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  setupTemplateEngine();
});

function renderPartial(partial: string, stackName: StackName): string {
  const ctx: TemplateContext = {
    projectName: 'my-project',
    repo: 'turborepo',
    apps: [{ appName: 'web', stackName, libraries: [] }],
    project: { tooling: [] },
    git: false,
  };
  return renderTemplate(`{{> ${partial}}}`, { ...ctx, ...ctx.apps[0] });
}

const compiles = (source: string) => new Bun.Transpiler({ loader: 'tsx' }).transformSync(source);

describe('the command palette partial', () => {
  test('a Next.js app navigates with the app router and runs on the client', () => {
    const palette = renderPartial('navigation/command-palette', 'nextjs');
    expect(palette.startsWith("'use client';")).toBe(true);
    expect(palette).toContain("from 'next/navigation'");
    expect(palette).toContain('router.push(url)');
    expect(palette).not.toContain('@tanstack/react-router');
    expect(() => compiles(palette)).not.toThrow();
  });

  test('a TanStack Start app navigates with its router and imports nothing from Next.js', () => {
    const palette = renderPartial('navigation/command-palette', 'tanstack-start');
    expect(palette).toContain("from '@tanstack/react-router'");
    expect(palette).toContain('router.navigate({ to: url })');
    expect(palette).not.toContain('next/');
    expect(palette).not.toContain('use client');
    expect(() => compiles(palette)).not.toThrow();
  });

  test('both stacks open pages from the one list the sidebar renders', () => {
    for (const stack of ['nextjs', 'tanstack-start'] as const) {
      expect(renderPartial('navigation/command-palette', stack)).toContain(
        "import { useAllowedRoutes } from '@/lib/allowed-routes'",
      );
      expect(renderPartial('org-dashboard/sidebar-links', stack)).toContain(
        "import { useAllowedRoutes } from '@/lib/allowed-routes'",
      );
      expect(renderPartial('org-dashboard/sidebar-links', stack)).not.toContain('export function useAllowedRoutes');
    }
  });

  test('the page-access rule lives with the route list, as a module of its own', () => {
    const rule = renderPartial('org-dashboard/allowed-routes', 'nextjs');
    expect(rule).toContain('export function useAllowedRoutes(');
    expect(rule).toContain("from '@/hooks/use-permission'");
    expect(rule).toContain("from '@/lib/constants'");
    expect(() => compiles(rule)).not.toThrow();
  });

  test('both stacks reuse the mounted hook for the hydration guard', () => {
    for (const stack of ['nextjs', 'tanstack-start'] as const) {
      const palette = renderPartial('navigation/command-palette', stack);
      expect(palette).toContain("import { useMounted } from '@/hooks/use-mounted'");
      expect(palette).not.toContain('useSyncExternalStore');
    }
  });
});

describe('the command component partial', () => {
  test('it renders the component of the ui package with no template syntax left', () => {
    const command = renderPartial('ui/command', 'nextjs');
    expect(command).toContain("from 'cmdk'");
    expect(command).not.toContain('{{');
    expect(() => compiles(command)).not.toThrow();
  });
});
