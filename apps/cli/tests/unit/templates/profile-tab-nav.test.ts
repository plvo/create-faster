import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';

const TAB_NAVS = [
  'cloudflare-fullstack-nextjs/src/components/profile/tab-nav.tsx.hbs',
  'org-dashboard-nextjs/src/components/profile/tab-nav.tsx.nextjs.hbs',
  'org-dashboard-tanstack-start/src/components/profile/tab-nav.tsx.hbs',
  'multitenant-saas-nextjs/apps/web/src/components/profile/tab-nav.tsx.hbs',
];

describe('profile tab navigation', () => {
  test.each(TAB_NAVS)('%s scrolls inside its own row and keeps every tab whole', (path) => {
    const source = readFileSync(join(TEMPLATES_DIR, 'blueprints', path), 'utf-8');

    expect(source).toContain('overflow-x-auto');
    expect(source).toContain('shrink-0');
    expect(source).toContain('whitespace-nowrap');
  });

  test.each(TAB_NAVS)('%s gives each tab a 44px touch target', (path) => {
    const source = readFileSync(join(TEMPLATES_DIR, 'blueprints', path), 'utf-8');

    expect(source).toContain('min-h-11');
  });
});
