import { describe, expect, test } from 'bun:test';
import { $when, resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';

function makeCtx(project: Partial<TemplateContext['project']> = {}): TemplateContext {
  return {
    projectName: 'test',
    repo: 'single',
    apps: [{ appName: 'test', stackName: 'nextjs', libraries: [] }],
    project: { tooling: [], ...project },
    git: true,
  };
}

describe('$when', () => {
  test('creates a tagged item that resolveConditionals recognizes', () => {
    const item = $when({ linter: 'biome' }, 'biome check');
    const ctx = makeCtx({ linter: 'biome' });
    const result = resolveConditionals([item], ctx);
    expect(result).toEqual(['biome check']);
  });

  test('non-matching item is excluded', () => {
    const item = $when({ linter: 'biome' }, 'biome check');
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals([item], ctx);
    expect(result).toEqual([]);
  });
});

describe('resolveConditionals', () => {
  test('keeps plain values unchanged', () => {
    const ctx = makeCtx();
    expect(resolveConditionals('hello', ctx)).toBe('hello');
    expect(resolveConditionals(42, ctx)).toBe(42);
    expect(resolveConditionals(null, ctx)).toBe(null);
  });

  test('filters $when items in arrays', () => {
    const data = [
      $when({ linter: 'biome' }, 'biome check --write'),
      $when({ linter: 'eslint' }, 'eslint --fix'),
      $when({ linter: 'prettier' }, 'prettier --write'),
    ];
    const ctx = makeCtx({ linter: 'biome' });
    expect(resolveConditionals(data, ctx)).toEqual(['biome check --write']);
  });

  test('mixes plain and $when items in arrays', () => {
    const data = ['always-here', $when({ linter: 'biome' }, 'biome check'), $when({ linter: 'eslint' }, 'eslint')];
    const ctx = makeCtx({ linter: 'biome' });
    expect(resolveConditionals(data, ctx)).toEqual(['always-here', 'biome check']);
  });

  test('resolves nested objects recursively', () => {
    const data = {
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check'), $when({ linter: 'eslint' }, 'eslint --fix')],
      },
    };
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({
      'lint-staged': {
        '*.ts': ['eslint --fix'],
      },
    });
  });

  test('omits keys whose resolved value is an empty object', () => {
    const data = {
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check')],
      },
    };
    const ctx = makeCtx({ linter: 'eslint' });
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({});
  });

  test('omits entire lint-staged when all glob patterns resolve to empty', () => {
    const data = {
      scripts: { prepare: 'husky' },
      'lint-staged': {
        '*.ts': [$when({ linter: 'biome' }, 'biome check')],
      },
    };
    const ctx = makeCtx();
    const result = resolveConditionals(data, ctx);
    expect(result).toEqual({ scripts: { prepare: 'husky' } });
  });
});

describe('compose expansion', () => {
  test('eslint-prettier composes to eslint + prettier', () => {
    const data = [
      $when({ linter: 'biome' }, 'biome check'),
      $when({ linter: 'eslint' }, 'eslint --fix'),
      $when({ linter: 'prettier' }, 'prettier --write'),
    ];
    const ctx = makeCtx({ linter: 'eslint-prettier' });
    expect(resolveConditionals(data, ctx)).toEqual(['eslint --fix', 'prettier --write']);
  });
});

describe('no selection', () => {
  test('all $when items removed when category not selected', () => {
    const data = {
      'lint-staged': {
        '*.ts': [
          $when({ linter: 'biome' }, 'biome check'),
          $when({ linter: 'eslint' }, 'eslint --fix'),
          $when({ linter: 'prettier' }, 'prettier --write'),
        ],
      },
    };
    const ctx = makeCtx();
    const result = resolveConditionals(data, ctx);
    expect(result['lint-staged']).toBeUndefined();
  });
});

describe('multiple conditions', () => {
  test('all conditions must match', () => {
    const item = $when({ linter: 'eslint', orm: 'drizzle' }, 'special-cmd');
    const ctxMatch = makeCtx({ linter: 'eslint', orm: 'drizzle' });
    const ctxPartial = makeCtx({ linter: 'eslint' });

    expect(resolveConditionals([item], ctxMatch)).toEqual(['special-cmd']);
    expect(resolveConditionals([item], ctxPartial)).toEqual([]);
  });
});
