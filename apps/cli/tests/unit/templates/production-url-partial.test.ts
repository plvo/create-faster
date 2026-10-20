import { beforeAll, describe, expect, test } from 'bun:test';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  setupTemplateEngine();
});

function contextWith(libraries: string[]): TemplateContext {
  return {
    projectName: 'my-site',
    repo: 'single',
    apps: [{ appName: 'my-site', stackName: 'nextjs', libraries }],
    project: { deployment: 'cloudflare', tooling: [] },
    git: false,
  };
}

function render(libraries: string[], hash = ''): string {
  const ctx = contextWith(libraries);
  return renderTemplate(`{{> cloudflare/production-url ${hash}}}`, { ...ctx, ...ctx.apps[0] });
}

const APP_URL_USE = 'appUrlUse="the app writes into the sitemap"';

describe('cloudflare/production-url partial', () => {
  test('renders nothing for an app that neither authenticates nor calls itself', () => {
    expect(render(['shadcn']).trim()).toBe('');
  });

  test('a caller that names what the app does with NEXT_PUBLIC_APP_URL opens the section', () => {
    const rendered = render(['shadcn'], APP_URL_USE);
    expect(rendered).toContain('### Production URL');
    expect(rendered).toContain('`NEXT_PUBLIC_APP_URL`, which Next.js freezes into the build and the app writes into the sitemap');
    expect(rendered).toContain('Build with it: `export NEXT_PUBLIC_APP_URL=<the URL>`');
    expect(rendered).not.toContain('tRPC');
  });

  test('joins the secret URL and the public URL with "and by" whatever reads the public one', () => {
    const rendered = render(['better-auth'], APP_URL_USE);
    expect(rendered).toContain(
      '`BETTER_AUTH_URL`, a secret a deploy fails without and by `NEXT_PUBLIC_APP_URL`, which Next.js freezes into the build and the app writes into the sitemap',
    );
  });

  test('keeps the tRPC reader when no caller names a use', () => {
    expect(render(['trpc'])).toContain('and the server-side tRPC client calls');
  });

  test('registers the workers.dev subdomain through the same token pipe when the account has none', () => {
    const rendered = render(['better-auth']);
    expect(rendered).toContain('`10007`');
    expect(rendered).toContain("| sed 's/^/Authorization: Bearer /' | curl -s -X PUT -H @- ");
    expect(rendered).toContain(`-d '{"subdomain":"<subdomain>"}' https://api.cloudflare.com/client/v4/accounts/<account id>/workers/subdomain`);
  });

  test('lists the URL of the Workers that read it and not of the Workers that do not', () => {
    const ctx: TemplateContext = {
      projectName: 'my-site',
      repo: 'turborepo',
      apps: [
        { appName: 'web', stackName: 'nextjs', libraries: ['better-auth'] },
        { appName: 'docs', stackName: 'nextjs', libraries: [] },
        { appName: 'cron', stackName: 'hono', libraries: [] },
      ],
      project: { deployment: 'cloudflare', tooling: [] },
      git: false,
    };
    const rendered = renderTemplate('{{> cloudflare/production-url appUrlUse="the app writes into the sitemap"}}', { ...ctx, ...ctx.apps[0] });

    expect(rendered).toContain('- `web`: `https://my-site-web.<subdomain>.workers.dev`');
    expect(rendered).toContain('- `docs`: `https://my-site-docs.<subdomain>.workers.dev`');
    expect(rendered).not.toContain('my-site-cron');
  });
});
