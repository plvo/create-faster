import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { TEMPLATES_DIR } from '@/lib/constants';
import { renderTimeFileAccess } from '../render-time-file-access';

const CODE_FILE = /\.[cm]?[jt]sx?(?:\.[a-z-]+)?\.hbs$/;
const BUILD_TIME_FILE = /\.config\.|\.test\.|\.spec\./;
const BUILD_TIME_DIRECTORIES = ['scripts'];
const BUILD_TIME_PARTIALS = ['local-setup'];

/** Only built when the project selects `sqlite`, a database that needs a local filesystem and is unavailable under a deployment without one (`providesLocalFilesystem: false`). */
const FILESYSTEM_DATABASE_TEMPLATES = ['project/orm/drizzle/src/index.ts.hbs'];

function isRuntimeSource(file: string): boolean {
  const segments = file.split(sep);
  if (!CODE_FILE.test(file) || BUILD_TIME_FILE.test(basename(file))) return false;
  if (segments.some((segment) => BUILD_TIME_DIRECTORIES.includes(segment))) return false;
  if (segments[0] === 'partials' && BUILD_TIME_PARTIALS.includes(segments[1] ?? '')) return false;
  return !FILESYSTEM_DATABASE_TEMPLATES.includes(file.split(sep).join('/'));
}

function runtimeSources(): Record<string, string> {
  const files = readdirSync(TEMPLATES_DIR, { recursive: true, encoding: 'utf-8' }).filter(isRuntimeSource);
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(TEMPLATES_DIR, file), 'utf-8')]));
}

describe('no template reads the filesystem while a Worker serves a request', () => {
  test('flags every way a page reads a file while it renders and spares generateStaticParams', () => {
    const page = (body: string) => `import fs from 'node:fs';\n\nexport default async function Page() {\n  ${body}\n}\n`;
    for (const body of [
      "fs.readFileSync('x');",
      "(await import('node:fs')).readFileSync('x');",
      "require('fs').readFileSync('x');",
      "(await import('fs/promises')).readFile('x');",
      'process.cwd();',
    ]) {
      expect(renderTimeFileAccess(page(body)), body).not.toEqual([]);
    }

    const buildOnly = `import fs from 'node:fs';\n\nexport function generateStaticParams() {\n  return fs.readdirSync('contents');\n}\n\nexport default function Page() {\n  return null;\n}\n`;
    expect(renderTimeFileAccess(buildOnly)).toEqual([]);
  });

  test('the scan covers the sources it is meant to cover and skips the build-time ones', () => {
    const scanned = Object.keys(runtimeSources()).map((file) => file.split(sep).join('/'));

    expect(scanned).toContain('blueprints/showcase-nextjs/src/lib/blog.ts.hbs');
    expect(scanned).toContain('libraries/mdx/src/app/mdx/[[...slug]]/page.tsx.nextjs.hbs');
    expect(scanned.some((file) => file.includes('/scripts/'))).toBe(false);
    expect(scanned.some((file) => file.endsWith('drizzle.config.ts.hbs'))).toBe(false);
  });

  test('a template reads files only inside generateStaticParams, which runs at build', () => {
    const offenders = Object.entries(runtimeSources())
      .filter(([, source]) => renderTimeFileAccess(source).length > 0)
      .map(([file]) => file.split(sep).join('/'));

    expect(offenders).toEqual([]);
  });
});
