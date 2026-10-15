import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { type BlueprintLinks, getAllTemplatesForContext, resolveBlueprintChain } from '@/lib/template-resolver';
import type { TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';
import { createFixtureTree, removeFixtureTree } from '../fixture-tree';
import { isBlueprintTemplate } from '../blueprint-template-source';

const BLUEPRINTS: BlueprintLinks = {
  parent: {},
  child: { extends: 'parent' },
  root: {},
  middle: { extends: 'root' },
  leaf: { extends: 'middle' },
  lonely: {},
  orphan: { extends: 'missing' },
  selfish: { extends: 'selfish' },
  ping: { extends: 'pong' },
  pong: { extends: 'ping' },
};

const skipFor = (...blueprints: string[]) => `---\nblueprintSkip:\n${blueprints.map((b) => `  - ${b}`).join('\n')}\n---\nbody\n`;

const FIXTURE_FILES: Record<string, string> = {
  'libraries/shadcn/structural.txt.hbs': 'structural\n',
  'libraries/shadcn/structural-kept.txt.hbs': 'structural\n',
  'blueprints/parent/inherited.txt.hbs': 'parent\n',
  'blueprints/parent/overridden.txt.hbs': 'parent\n',
  'blueprints/parent/structural.txt.hbs': 'parent\n',
  'blueprints/parent/skipped-for-child.txt.hbs': skipFor('child'),
  'blueprints/parent/skipped-for-parent.txt.hbs': skipFor('parent'),
  'blueprints/parent/page.tsx.nextjs.hbs': 'parent next page\n',
  'blueprints/parent/shared-page.tsx.nextjs.hbs': 'parent next page\n',
  'blueprints/child/overridden.txt.hbs': 'child\n',
  'blueprints/child/structural.txt.hbs': 'child\n',
  'blueprints/child/child-only.txt.hbs': 'child\n',
  'blueprints/child/page.tsx.tanstack-start.hbs': 'child start page\n',
  'blueprints/root/from-root.txt.hbs': 'root\n',
  'blueprints/root/contested.txt.hbs': 'root\n',
  'blueprints/middle/from-middle.txt.hbs': 'middle\n',
  'blueprints/middle/contested.txt.hbs': 'middle\n',
  'blueprints/leaf/contested.txt.hbs': 'leaf\n',
  'blueprints/lonely/lonely.txt.hbs': 'lonely\n',
};

let templatesDir: string;

beforeAll(() => {
  templatesDir = createFixtureTree('blueprint-extends-', FIXTURE_FILES);
});

afterAll(() => {
  removeFixtureTree(templatesDir);
});

function makeCtx(blueprint: string, stackName: StackName = 'nextjs'): TemplateContext {
  return {
    projectName: 'proj',
    repo: 'single',
    apps: [{ appName: 'proj', stackName, libraries: ['shadcn'] }],
    project: { tooling: [] },
    git: false,
    blueprint,
  };
}

const templatesOf = (blueprint: string, stackName?: StackName) =>
  getAllTemplatesForContext(makeCtx(blueprint, stackName), templatesDir, BLUEPRINTS);

const destinationsOf = (blueprint: string, stackName?: StackName) =>
  templatesOf(blueprint, stackName).map((t) => t.destination);

const sourcesAt = (blueprint: string, destination: string, stackName?: StackName) =>
  templatesOf(blueprint, stackName)
    .filter((t) => t.destination === destination)
    .map((t) => t.source.slice(templatesDir.length + 1));

describe('resolveBlueprintChain', () => {
  test('lists the parents first and the selected blueprint last', () => {
    expect(resolveBlueprintChain('leaf', BLUEPRINTS)).toEqual(['root', 'middle', 'leaf']);
  });

  test('a blueprint without extends is its own chain', () => {
    expect(resolveBlueprintChain('lonely', BLUEPRINTS)).toEqual(['lonely']);
  });

  test('rejects a parent that is not a blueprint', () => {
    expect(() => resolveBlueprintChain('orphan', BLUEPRINTS)).toThrow(/orphan.*missing/);
  });

  test('rejects a blueprint that extends itself', () => {
    expect(() => resolveBlueprintChain('selfish', BLUEPRINTS)).toThrow(/cycle.*selfish/);
  });

  test('rejects a cycle between blueprints', () => {
    expect(() => resolveBlueprintChain('ping', BLUEPRINTS)).toThrow(/cycle.*ping.*pong/);
  });
});

describe('extends in META', () => {
  test.each(Object.keys(META.blueprints))('the chain of "%s" is valid', (name) => {
    expect(() => resolveBlueprintChain(name)).not.toThrow();
  });
});

describe('extends in the template resolver', () => {
  test('the child gets the parent templates and its own', () => {
    const destinations = destinationsOf('child');
    expect(destinations).toContain('inherited.txt');
    expect(destinations).toContain('child-only.txt');
  });

  test('the parent does not get the files of its child', () => {
    const destinations = destinationsOf('parent');
    expect(destinations).toContain('inherited.txt');
    expect(destinations).not.toContain('child-only.txt');
  });

  test('the child wins per destination, once', () => {
    expect(sourcesAt('child', 'overridden.txt')).toEqual(['blueprints/child/overridden.txt.hbs']);
    expect(sourcesAt('parent', 'overridden.txt')).toEqual(['blueprints/parent/overridden.txt.hbs']);
  });

  test('the nearest blueprint of a chain wins', () => {
    expect(sourcesAt('leaf', 'contested.txt')).toEqual(['blueprints/leaf/contested.txt.hbs']);
    expect(sourcesAt('middle', 'contested.txt')).toEqual(['blueprints/middle/contested.txt.hbs']);
    expect(destinationsOf('leaf')).toEqual(expect.arrayContaining(['from-root.txt', 'from-middle.txt']));
  });

  test('inherited and own files replace structural templates, the child last', () => {
    expect(sourcesAt('parent', 'structural.txt')).toEqual(['blueprints/parent/structural.txt.hbs']);
    expect(sourcesAt('child', 'structural.txt')).toEqual(['blueprints/child/structural.txt.hbs']);
    expect(sourcesAt('child', 'structural-kept.txt')).toEqual(['libraries/shadcn/structural-kept.txt.hbs']);
  });

  test('a stack suffix limits an inherited file to the apps of that stack', () => {
    expect(sourcesAt('child', 'page.tsx', 'nextjs')).toEqual(['blueprints/parent/page.tsx.nextjs.hbs']);
    expect(destinationsOf('child', 'tanstack-start')).not.toContain('shared-page.tsx');
    expect(sourcesAt('child', 'page.tsx', 'tanstack-start')).toEqual(['blueprints/child/page.tsx.tanstack-start.hbs']);
  });
});

describe('scanning the templates of a blueprint', () => {
  const scanned = (blueprint: string) =>
    templatesOf(blueprint)
      .filter((t) => isBlueprintTemplate(t.source, blueprint, BLUEPRINTS))
      .map((t) => t.source.slice(templatesDir.length + 1));

  test('includes the templates inherited from every parent of the chain', () => {
    expect(scanned('leaf')).toEqual(
      expect.arrayContaining([
        'blueprints/root/from-root.txt.hbs',
        'blueprints/middle/from-middle.txt.hbs',
        'blueprints/leaf/contested.txt.hbs',
      ]),
    );
  });

  test('leaves out structural templates and the folders of other blueprints', () => {
    const sources = scanned('child');
    expect(sources).toContain('blueprints/parent/inherited.txt.hbs');
    expect(sources.filter((source) => !source.startsWith('blueprints/parent/') && !source.startsWith('blueprints/child/'))).toEqual([]);
  });
});

describe('blueprintSkip over an extends chain', () => {
  test('a file skipped for the child is skipped for the child only', () => {
    expect(destinationsOf('child')).not.toContain('skipped-for-child.txt');
    expect(destinationsOf('parent')).toContain('skipped-for-child.txt');
  });

  test('a file skipped for the parent is still inherited by the child', () => {
    expect(destinationsOf('parent')).not.toContain('skipped-for-parent.txt');
    expect(destinationsOf('child')).toContain('skipped-for-parent.txt');
  });
});
