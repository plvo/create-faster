import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { cleanupTempDir, createTempDir, evaluateGeneratedModule, filesUnder, readTextFile, runCli } from './helpers';
import { setIntegrationTimeout } from './timeout';

setIntegrationTimeout();

const BLUEPRINTS = [
  'org-dashboard-nextjs',
  'org-dashboard-tanstack-start',
  'multitenant-saas-nextjs',
  'cloudflare-fullstack-nextjs',
];

const HELPER_PATH = 'apps/web/src/lib/format-date.ts';
const LOCALE_DEPENDENT_DATE_CALL = /\.toLocale(?:Date|Time)?String\(/;

type DateFormat = 'date' | 'long' | 'dateTime';
type FormatDate = (value: Date | string | number, format?: DateFormat) => string;

const TIME_ZONES = ['Pacific/Kiritimati', 'UTC', 'America/Los_Angeles'];
const NEAR_MIDNIGHT = '2026-10-21T23:30:00.000Z';

describe('dates rendered by the dashboards', () => {
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

  const loadHelper = async (blueprint: string): Promise<FormatDate> => {
    const source = await readTextFile(join(projectPaths.get(blueprint) as string, HELPER_PATH));
    const { formatDate } = await evaluateGeneratedModule<{ formatDate: FormatDate }>(
      source,
      join(tempDir, `${blueprint}-format-date.mjs`),
    );
    return formatDate;
  };

  describe.each(BLUEPRINTS)('%s', (blueprint) => {
    test('no component formats a date with the locale and time zone of the machine that renders it', async () => {
      const root = projectPaths.get(blueprint) as string;
      const sources = (await filesUnder(root, ['node_modules'])).filter((file) => /\.(ts|tsx)$/.test(file));
      const offenders: string[] = [];
      for (const file of sources) {
        if (LOCALE_DEPENDENT_DATE_CALL.test(await readTextFile(file))) offenders.push(file.slice(root.length + 1));
      }
      expect(offenders).toEqual([]);
    });

    test('formatDate gives the server and every browser the same text', async () => {
      const formatDate = await loadHelper(blueprint);
      const previousZone = process.env.TZ;
      try {
        const texts = TIME_ZONES.map((zone) => {
          process.env.TZ = zone;
          return {
            date: formatDate(NEAR_MIDNIGHT),
            long: formatDate(new Date(NEAR_MIDNIGHT), 'long'),
            dateTime: formatDate(Date.parse(NEAR_MIDNIGHT), 'dateTime'),
          };
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
