import { describe, expect, test } from 'bun:test';
import { cleanUndefined, processScriptPorts, sortObjectKeys, spreadExtraKeys } from '@/lib/utils';

describe('sortObjectKeys', () => {
  test('sorts keys alphabetically', () => {
    const result = sortObjectKeys({ c: 3, a: 1, b: 2 });
    expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
  });

  test('preserves values', () => {
    const result = sortObjectKeys({ b: 'two', a: 'one' });
    expect(result).toEqual({ a: 'one', b: 'two' });
  });

  test('handles empty object', () => {
    const result = sortObjectKeys({});
    expect(result).toEqual({});
  });
});

describe('cleanUndefined', () => {
  test('removes undefined values', () => {
    const result = cleanUndefined({ a: 1, b: undefined, c: 'hello' });
    expect(result).toEqual({ a: 1, c: 'hello' });
  });

  test('keeps null values', () => {
    const result = cleanUndefined({ a: null, b: 1 });
    expect(result).toEqual({ a: null, b: 1 });
  });

  test('handles object with no undefined', () => {
    const result = cleanUndefined({ a: 1, b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('handles empty object', () => {
    const result = cleanUndefined({});
    expect(result).toEqual({});
  });
});

describe('spreadExtraKeys', () => {
  test('copies non-merge keys from config to target', () => {
    const target: Record<string, unknown> = { name: 'test' };
    spreadExtraKeys(target, { type: 'module', 'lint-staged': { '*.ts': ['biome check'] } });
    expect(target.type).toBe('module');
    expect(target['lint-staged']).toEqual({ '*.ts': ['biome check'] });
  });

  test('skips dependencies, devDependencies, scripts, exports', () => {
    const target: Record<string, unknown> = { name: 'test' };
    spreadExtraKeys(target, {
      dependencies: { a: '1' },
      devDependencies: { b: '2' },
      scripts: { dev: 'next dev' },
      exports: { '.': './index.ts' },
      custom: 'value',
    });
    expect(target.dependencies).toBeUndefined();
    expect(target.devDependencies).toBeUndefined();
    expect(target.scripts).toBeUndefined();
    expect(target.exports).toBeUndefined();
    expect(target.custom).toBe('value');
  });

  test('skips undefined values', () => {
    const target: Record<string, unknown> = { name: 'test' };
    spreadExtraKeys(target, { type: undefined });
    expect(target.type).toBeUndefined();
  });
});

describe('processScriptPorts', () => {
  test('replaces {{port}} placeholder with port number', () => {
    const result = processScriptPorts({ dev: 'next dev --port {{port}}' }, 3000);
    expect(result.dev).toBe('next dev --port 3000');
  });

  test('removes --port {{port}} when no port provided', () => {
    const result = processScriptPorts({ dev: 'next dev --port {{port}}' });
    expect(result.dev).toBe('next dev');
  });

  test('handles scripts without port placeholder', () => {
    const result = processScriptPorts({ build: 'next build' }, 3000);
    expect(result.build).toBe('next build');
  });

  test('handles multiple scripts', () => {
    const result = processScriptPorts({ dev: 'next dev --port {{port}}', build: 'next build' }, 3001);
    expect(result.dev).toBe('next dev --port 3001');
    expect(result.build).toBe('next build');
  });

  test('handles empty scripts object', () => {
    const result = processScriptPorts({}, 3000);
    expect(result).toEqual({});
  });
});
