import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, fileExists, filesUnder, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = Object.keys(META.blueprints);

// The blueprints that show dates: the four dashboards and the two with a blog.
const BLUEPRINTS_WITH_DATES = [
  'org-dashboard-nextjs',
  'org-dashboard-tanstack-start',
  'multitenant-saas-nextjs',
  'cloudflare-fullstack-nextjs',
  'showcase-nextjs',
  'cloudflare-static-site-nextjs',
];

const HELPER_PATHS = ['apps/web/src/lib/format-date.ts', 'src/lib/format-date.ts'];
const LOCALE_DEPENDENT_DATE_CALL = /\.toLocale(?:Date|Time)?String\(/;
const DATE_FORMATTER_CALL = /Intl\.DateTimeFormat\(/;

type DateFormat = 'date' | 'long' | 'dateTime';
type FormatDate = (value: Date | string | number, format?: DateFormat) => string;

const TIME_ZONES = ['Pacific/Kiritimati', 'UTC', 'America/Los_Angeles'];
const NEAR_MIDNIGHT = '2026-10-21T23:30:00.000Z';
const OTHER_LOCALE = 'fr-FR';

// A browser whose language is not the helper's: a formatter that is given no locale answers in this one.
function withBrowserLocale<T>(locale: string, run: () => T): T {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  const BrowserDateTimeFormat = new Proxy(RealDateTimeFormat, {
    construct: (target, [requested, options]) => new target(requested ?? locale, options),
    apply: (target, _this, [requested, options]) => target(requested ?? locale, options),
  });
  Object.defineProperty(Intl, 'DateTimeFormat', { value: BrowserDateTimeFormat, configurable: true, writable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(Intl, 'DateTimeFormat', { value: RealDateTimeFormat, configurable: true, writable: true });
  }
}

describe('dates rendered by the blueprints', () => {
  let tempDir: string;
  const projectPaths = new Map<string, string>();

  beforeAll(async () => {
    tempDir = await createTempDir();
    for (const blueprint of BLUEPRINTS) {
      const result = await runCli([blueprint, '--blueprint', blueprint, '--no-git', '--no-install', '--pm', 'bun'], tempDir);
      expect(result.exitCode, result.stderr).toBe(0);
      projectPaths.set(blueprint, join(tempDir, blueprint));
    }
  });

  afterAll(async () => {
    await cleanupTempDir(tempDir);
  });

  const helperPathOf = async (blueprint: string): Promise<string | undefined> => {
    const root = projectPaths.get(blueprint) as string;
    for (const path of HELPER_PATHS) if (await fileExists(join(root, path))) return join(root, path);
    return undefined;
  };

  const loadHelper = async (blueprint: string): Promise<FormatDate> => {
    const path = await helperPathOf(blueprint);
    if (!path) throw new Error(`${blueprint} has no format-date helper`);
    const { formatDate } = await evaluateGeneratedModule<{ formatDate: FormatDate }>(
      await readTextFile(path),
      join(tempDir, `${blueprint}-format-date.mjs`),
    );
    return formatDate;
  };

  describe.each(BLUEPRINTS)('%s', (blueprint) => {
    test('no source formats a date with the locale or time zone of the machine that renders it', async () => {
      const root = projectPaths.get(blueprint) as string;
      const helper = await helperPathOf(blueprint);
      const sources = (await filesUnder(root, ['node_modules'])).filter((file) => /\.(ts|tsx)$/.test(file));
      const offenders: string[] = [];
      for (const file of sources) {
        const text = await readTextFile(file);
        const formatsDate = LOCALE_DEPENDENT_DATE_CALL.test(text) || (file !== helper && DATE_FORMATTER_CALL.test(text));
        if (formatsDate) offenders.push(file.slice(root.length + 1));
      }
      expect(offenders).toEqual([]);
    });
  });

  describe.each(BLUEPRINTS_WITH_DATES)('%s helper', (blueprint) => {
    test('formatDate gives the server and every browser the same text, whatever its time zone and language', async () => {
      const formatDate = await loadHelper(blueprint);
      const previousZone = process.env.TZ;
      try {
        const texts = TIME_ZONES.map((zone) => {
          process.env.TZ = zone;
          return withBrowserLocale(OTHER_LOCALE, () => ({
            date: formatDate(NEAR_MIDNIGHT),
            long: formatDate(new Date(NEAR_MIDNIGHT), 'long'),
            dateTime: formatDate(Date.parse(NEAR_MIDNIGHT), 'dateTime'),
          }));
        });
        for (const text of texts) expect(text).toEqual(texts[0] as (typeof texts)[number]);
        expect(texts[0]).toEqual({
          date: 'Oct 21, 2026',
          long: 'October 21, 2026',
          dateTime: 'Oct 21, 11:30 PM UTC',
        });
      } finally {
        if (previousZone === undefined) delete process.env.TZ;
        else process.env.TZ = previousZone;
      }
    });
  });
});
