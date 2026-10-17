import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { filesystemAccess } from '../render-time-file-access';

const CODE_FILE = /\.[cm]?[jt]sx?(?:\.[a-z-]+)?\.hbs$/;
const BUILD_TIME_FILE = /\.config\.|\.test\.|\.spec\./;
const BUILD_TIME_DIRECTORIES = ['scripts', 'local-setup'];

/** Only built when the project selects `sqlite`, a database that needs a local filesystem and is unavailable under a deployment without one (`providesLocalFilesystem: false`). */
const FILESYSTEM_DATABASE_TEMPLATES = ['project/orm/drizzle/src/index.ts.hbs'];

function isRuntimeSource(file: string): boolean {
  const segments = file.split(sep);
  const isPartial = segments[0] === 'partials';
  if (!file.endsWith('.hbs') || (!isPartial && !CODE_FILE.test(file))) return false;
  if (BUILD_TIME_FILE.test(basename(file))) return false;
  if (segments.some((segment) => BUILD_TIME_DIRECTORIES.includes(segment))) return false;
  return !FILESYSTEM_DATABASE_TEMPLATES.includes(segments.join('/'));
}

function runtimeSources(): Record<string, string> {
  const files = readdirSync(TEMPLATES_DIR, { recursive: true, encoding: 'utf-8' }).filter(isRuntimeSource);
  return Object.fromEntries(
    files.map((file) => [file.split(sep).join('/'), readFileSync(join(TEMPLATES_DIR, file), 'utf-8')]),
  );
}

describe('no template reads the filesystem while a Worker serves a request', () => {
  test('flags every way a source reaches the filesystem, whatever the imports are called', () => {
    for (const source of [
      "import fs from 'node:fs';",
      "import { readdirSync as list } from 'node:fs';",
      "import * as files from 'fs';",
      "import { readFile as load } from 'node:fs/promises';",
      "const { readFileSync } = await import('node:fs');",
      "const read = require('fs').readFileSync;",
      'const root = process.cwd();',
    ]) {
      expect(filesystemAccess(source), source).not.toEqual([]);
    }

    expect(filesystemAccess("import path from 'node:path';\nimport { notFound } from 'next/navigation';")).toEqual([]);
  });

  test('the scan covers the sources it is meant to cover and skips the build-time ones', () => {
    const scanned = Object.keys(runtimeSources());

    expect(scanned).toContain('blueprints/showcase-nextjs/src/lib/blog.ts.hbs');
    expect(scanned).toContain('libraries/mdx/src/app/mdx/[[...slug]]/page.tsx.nextjs.hbs');
    expect(scanned).toContain('partials/blog/posts.hbs');
    expect(scanned.some((file) => file.includes('/scripts/'))).toBe(false);
    expect(scanned.some((file) => file.startsWith('partials/local-setup/'))).toBe(false);
    expect(scanned.some((file) => file.endsWith('drizzle.config.ts.hbs'))).toBe(false);
  });

  test('no template or partial imports an fs module or reads the working directory', () => {
    const offenders = Object.entries(runtimeSources())
      .filter(([, source]) => filesystemAccess(source).length > 0)
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
