import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META } from '@/__meta__';

const DOCS_DIR = join(import.meta.dir, '../../../www/content/docs');

describe('versions written in the docs', () => {
  test('the portless page names the version META pins', () => {
    const page = readFileSync(join(DOCS_DIR, 'extras/portless.mdx'), 'utf-8');
    const pinned = META.project.tooling.options.portless?.packageJson?.devDependencies?.portless;
    expect(pinned).toBeDefined();
    expect(page).toContain(`- \`portless\` \`${pinned}\` (dev)`);
  });
});
