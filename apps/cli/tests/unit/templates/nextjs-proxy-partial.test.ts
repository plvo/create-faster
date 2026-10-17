import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { removeFrontmatter } from '@/lib/frontmatter';
import { renderTemplate, setupTemplateEngine } from '@/lib/handlebars';
import type { TemplateContext } from '@/types/ctx';

beforeAll(() => {
  setupTemplateEngine();
});

// A blueprint cannot add evlog or posthog, so the combination is rendered here: the proxy of the stack and the
// proxies of the two blueprints that forward the requested path all come from the one partial.
function render(relativePath: string, deployment?: string): string {
  const ctx: TemplateContext = {
    projectName: 'my-project',
    repo: 'single',
    apps: [{ appName: 'web', stackName: 'nextjs', libraries: ['better-auth', 'evlog', 'posthog'] }],
    project: { deployment, tooling: [] },
    git: false,
  };
  const content = removeFrontmatter(readFileSync(join(TEMPLATES_DIR, relativePath), 'utf-8'));
  return renderTemplate(content, { ...ctx, ...ctx.apps[0] });
}

const STACK_PROXY = 'stack/nextjs/src/proxy.ts.hbs';
const FORWARDING_PROXIES = [
  'blueprints/org-dashboard-nextjs/src/proxy.ts.nextjs.hbs',
  'blueprints/cloudflare-fullstack-nextjs/src/proxy.ts.hbs',
];

describe('the Next.js proxy partial', () => {
  test('the stack proxy forwards nothing, even with better-auth', () => {
    const proxy = render(STACK_PROXY);
    expect(proxy).not.toContain('REQUEST_PATH_HEADER');
    expect(proxy).toContain('withEvlog(request)');
    expect(proxy).toContain('api|ingest|_next/static');
  });

  test.each(FORWARDING_PROXIES)('%s forwards the path and keeps the evlog and posthog sections', (file) => {
    const proxy = render(file);
    expect(proxy).toContain("import { NextRequest } from 'next/server';");
    expect(proxy).toContain("import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';");
    expect(proxy).toContain('requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${request.nextUrl.search}`);');
    expect(proxy).toContain('withEvlog(new NextRequest(request, { headers: requestHeaders }))');
    expect(proxy).toContain('api|ingest|_next/static');
  });

  test.each([STACK_PROXY, ...FORWARDING_PROXIES])('%s is a middleware under cloudflare and a proxy elsewhere', (file) => {
    expect(render(file, 'cloudflare')).toContain('export default async function middleware(request: NextRequest)');
    expect(render(file)).toContain('export default async function proxy(request: NextRequest)');
  });
});
