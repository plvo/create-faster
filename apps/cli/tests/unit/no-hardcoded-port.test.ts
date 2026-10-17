import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { templateSources } from '../template-sources';

const META_SOURCE = join(import.meta.dir, '../../src/__meta__.ts');

// The ports an app gets are 3000 + its index. A template or a META script that writes one of them
// out stays on it when the app moves, so it takes `appPort` or `appUrl` instead.
const APP_PORT = /\b300\d\b/;

function linesWithAppPort(source: string): string[] {
  return source.split('\n').filter((line) => APP_PORT.test(line));
}

describe('no hardcoded app port', () => {
  test('no template writes the port of an app', () => {
    const offenders = Object.entries(templateSources()).flatMap(([file, source]) =>
      linesWithAppPort(source).map((line) => `${file}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  test('META writes the port of an app nowhere', () => {
    expect(linesWithAppPort(readFileSync(META_SOURCE, 'utf-8'))).toEqual([]);
  });
});
