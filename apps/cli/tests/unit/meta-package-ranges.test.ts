import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { isWhenItem } from '@/lib/when';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'];

interface Declaration {
  choice: string;
  range: string;
  /** A deployment's own `stackPackageJson`, which replaces the range the stack declares (the `next` of OpenNext). */
  overridesStack: boolean;
}

/** The choice a META path belongs to: a stack, a library, a project option, a blueprint or a repo type. */
function choiceOf(path: string[]): string {
  const [group, category, , option] = path;
  return group === 'project' ? `project.${category}.${option}` : `${group}.${category}`;
}

function rangesOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return isWhenItem(value) ? rangesOf(value.value) : [];
}

/** Every range META gives a package in a `dependencies` or `devDependencies` map, wherever the map sits in a choice. */
function collectDeclarations(node: unknown, path: string[], found: Map<string, Declaration[]>): void {
  if (isWhenItem(node)) return collectDeclarations(node.value, path, found);
  if (Array.isArray(node)) return node.forEach((item) => collectDeclarations(item, path, found));
  if (node === null || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (DEPENDENCY_FIELDS.includes(key) && value !== null && typeof value === 'object') {
      for (const [name, declared] of Object.entries(value)) {
        for (const range of rangesOf(declared)) {
          const choice = choiceOf(path);
          const overridesStack = choice.startsWith('project.deployment.') && path.includes('stackPackageJson');
          found.set(name, [...(found.get(name) ?? []), { choice, range, overridesStack }]);
        }
      }
      continue;
    }
    collectDeclarations(value, [...path, key], found);
  }
}

/** The packages a stack or library fixes at its own version, by choice. */
function pinnedByChoice(): Map<string, string[]> {
  const pinned = new Map<string, string[]>();
  for (const [name, stack] of Object.entries(META.stacks)) pinned.set(`stacks.${name}`, stack.pinnedPackages ?? []);
  for (const [name, library] of Object.entries(META.libraries)) {
    pinned.set(`libraries.${name}`, library.pinnedPackages ?? []);
  }
  return pinned;
}

/** Choices a project holds one of: the blueprints, and the options of a single-selection category. */
function exclusiveFamilyOf(choice: string): string | undefined {
  const [group, category] = choice.split('.');
  if (group === 'blueprints') return 'blueprints';
  const selection = group === 'project' ? META.project[category as keyof typeof META.project]?.selection : undefined;
  return selection === 'single' ? `project.${category}` : undefined;
}

function coexist(first: string, second: string): boolean {
  const family = exclusiveFamilyOf(first);
  return family === undefined || family !== exclusiveFamilyOf(second);
}

describe('package ranges in META', () => {
  const declarations = new Map<string, Declaration[]>();
  collectDeclarations(META, [], declarations);
  const pinned = pinnedByChoice();

  test('the walk finds the packages of every kind of choice', () => {
    const choices = new Set([...declarations.values()].flat().map(({ choice }) => choice.split('.')[0]));
    expect([...choices].sort()).toEqual(['blueprints', 'libraries', 'project', 'repo', 'stacks']);
  });

  test('two choices of one project declare a package on one range, but a pinned package and a deployment override', () => {
    const conflicts = [...declarations].flatMap(([name, declared]) => {
      const compared = declared.filter(
        ({ choice, overridesStack }) => !overridesStack && !pinned.get(choice)?.includes(name),
      );
      return compared.flatMap((first, index) =>
        compared
          .slice(index + 1)
          .filter((second) => second.range !== first.range && coexist(first.choice, second.choice))
          .map((second) => `${name}: ${first.range} (${first.choice}) and ${second.range} (${second.choice})`),
      );
    });

    expect(conflicts).toEqual([]);
  });
});
