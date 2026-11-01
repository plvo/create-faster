import { beforeAll, describe, expect, test } from 'bun:test';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { StackName } from '@/types/stack-name';
import type { TemplateContext } from '@/types/ctx';
import { templateSources } from '../../template-sources';

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

describe('the command palette partial with Hugeicons', () => {
  let palette: string;

  beforeAll(() => {
    palette = renderPartial('navigation/command-palette icons="hugeicons"', 'nextjs');
  });

  test('it compiles', () => {
    expect(() => compiles(palette)).not.toThrow();
  });

  test('the icons are Hugeicons and lucide-react is not imported', () => {
    expect(palette).toContain("import { Search01Icon } from '@hugeicons/core-free-icons'");
    expect(palette).toContain("import { HugeiconsIcon } from '@hugeicons/react'");
    expect(palette).toContain('<HugeiconsIcon icon={page.icon} />');
    expect(palette).toContain('<HugeiconsIcon icon={Search01Icon} />');
    expect(palette).not.toContain('lucide-react');
  });

  test('without the option the icons are lucide', () => {
    const plain = renderPartial('navigation/command-palette', 'nextjs');
    expect(plain).toContain("import { Search } from 'lucide-react'");
    expect(plain).not.toContain('@hugeicons');
  });
});

describe('the pages of the command palette', () => {
  // One mechanism for every blueprint: the layout hands the role it read on the server to the provider, which gives it
  // to the useAllowedRoutes of the project. A project whose pages do not follow the role simply leaves it out.
  test.each([
    ['nextjs', ''],
    ['nextjs', ' icons="hugeicons"'],
    ['tanstack-start', ''],
  ] as const)('on %s%s the provider takes an optional role and passes it on', (stack, options) => {
    const palette = renderPartial(`navigation/command-palette${options}`, stack);
    expect(palette).toContain('export function CommandPaletteProvider({ role, children }: { role?: string | null; children: ReactNode })');
    expect(palette).toContain('useAllowedRoutes(role)');
  });
});

describe('the dialog partial', () => {
  test('it renders the dialog of a ui package, which the command component builds on', () => {
    const dialog = renderPartial('ui/dialog', 'nextjs');
    expect(dialog).toContain('function DialogContent(');
    expect(dialog).not.toContain('{{');
    expect(() => compiles(dialog)).not.toThrow();
  });

  test.each(['org-dashboard-nextjs', 'cloudflare-fullstack-nextjs', 'multitenant-saas-nextjs'])(
    '%s ships the dialog from the partial, not a copy of its own',
    (blueprint) => {
      const source = templateSources()[`blueprints/${blueprint}/packages/ui/src/components/ui/dialog.tsx.hbs`];
      expect(source?.replace(/^---\n[\s\S]*?\n---\n/, '').trim()).toBe('{{> ui/dialog}}');
    },
  );
});

describe('the command component partial', () => {
  test('it renders the component of the ui package with no template syntax left', () => {
    const command = renderPartial('ui/command', 'nextjs');
    expect(command).toContain("from 'cmdk'");
    expect(command).not.toContain('{{');
    expect(() => compiles(command)).not.toThrow();
  });
});
