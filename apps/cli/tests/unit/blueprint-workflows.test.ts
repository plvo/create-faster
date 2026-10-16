import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { BlueprintLinks } from '@/lib/template-resolver';
import { shipsWorkflows } from '../blueprint-workflows';
import { createFixtureTree, removeFixtureTree } from './fixture-tree';

const BLUEPRINTS: BlueprintLinks = {
  parent: {},
  child: { extends: 'parent' },
  plain: {},
  plainChild: { extends: 'plain' },
};

describe('blueprints that ship workflows', () => {
  let blueprintsDir: string;

  beforeAll(() => {
    const root = createFixtureTree('blueprint-workflows-', {
      'blueprints/parent/__github/workflows/ci.yml': 'name: ci\n',
      'blueprints/child/src/index.ts': '',
      'blueprints/plain/src/index.ts': '',
      'blueprints/plainChild/src/index.ts': '',
    });
    blueprintsDir = join(root, 'blueprints');
  });

  afterAll(() => {
    removeFixtureTree(join(blueprintsDir, '..'));
  });

  test('a blueprint is found through the folder of the blueprint it extends', () => {
    expect(shipsWorkflows('parent', blueprintsDir, BLUEPRINTS)).toBe(true);
    expect(shipsWorkflows('child', blueprintsDir, BLUEPRINTS)).toBe(true);
  });

  test('a blueprint whose chain ships none is not', () => {
    expect(shipsWorkflows('plain', blueprintsDir, BLUEPRINTS)).toBe(false);
    expect(shipsWorkflows('plainChild', blueprintsDir, BLUEPRINTS)).toBe(false);
  });
});
