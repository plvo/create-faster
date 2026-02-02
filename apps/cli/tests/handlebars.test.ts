// ABOUTME: Unit tests for Handlebars helpers
// ABOUTME: Tests helpers for unified addon system

import { beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from '../src/lib/handlebars';

describe('Handlebars helpers', () => {
  beforeAll(() => {
    registerHandlebarsHelpers();
  });

  describe('eq', () => {
    test('returns true for equal values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('yes');
    });

    test('returns false for different values', () => {
      const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('no');
    });
  });

  describe('ne', () => {
    test('returns true for different values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'bar' })).toBe('yes');
    });

    test('returns false for equal values', () => {
      const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
      expect(template({ a: 'foo', b: 'foo' })).toBe('no');
    });
  });

  describe('and', () => {
    test('returns true when all values are truthy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: true, c: true })).toBe('yes');
    });

    test('returns false when any value is falsy', () => {
      const template = Handlebars.compile('{{#if (and a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: true, b: false, c: true })).toBe('no');
    });
  });

  describe('or', () => {
    test('returns true when any value is truthy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: true, c: false })).toBe('yes');
    });

    test('returns false when all values are falsy', () => {
      const template = Handlebars.compile('{{#if (or a b c)}}yes{{else}}no{{/if}}');
      expect(template({ a: false, b: false, c: false })).toBe('no');
    });
  });

  describe('isTurborepo', () => {
    test('returns true for turborepo', () => {
      const template = Handlebars.compile('{{#if (isTurborepo)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'turborepo' })).toBe('yes');
    });

    test('returns false for single', () => {
      const template = Handlebars.compile('{{#if (isTurborepo)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'single' })).toBe('no');
    });
  });

  describe('has', () => {
    test('checks module (per-app addon) existence', () => {
      const template = Handlebars.compile('{{#if (has "module" "shadcn")}}yes{{else}}no{{/if}}');
      expect(template({ addons: ['shadcn', 'mdx'] })).toBe('yes');
      expect(template({ addons: ['mdx'] })).toBe('no');
      expect(template({ addons: [] })).toBe('no');
    });

    test('checks database (global addon) value', () => {
      const template = Handlebars.compile('{{#if (has "database" "postgres")}}yes{{else}}no{{/if}}');
      expect(template({ globalAddons: ['postgres'] })).toBe('yes');
      expect(template({ globalAddons: ['mysql'] })).toBe('no');
      expect(template({ globalAddons: [] })).toBe('no');
    });

    test('checks orm (global addon) value', () => {
      const template = Handlebars.compile('{{#if (has "orm" "drizzle")}}yes{{else}}no{{/if}}');
      expect(template({ globalAddons: ['drizzle'] })).toBe('yes');
      expect(template({ globalAddons: ['prisma'] })).toBe('no');
    });

    test('checks extra (global addon) existence', () => {
      const template = Handlebars.compile('{{#if (has "extra" "biome")}}yes{{else}}no{{/if}}');
      expect(template({ globalAddons: ['biome', 'husky'] })).toBe('yes');
      expect(template({ globalAddons: ['husky'] })).toBe('no');
    });

    test('checks addon (any addon) existence', () => {
      const template = Handlebars.compile('{{#if (has "addon" "shadcn")}}yes{{else}}no{{/if}}');
      expect(template({ addons: ['shadcn'] })).toBe('yes');
      expect(template({ globalAddons: ['shadcn'] })).toBe('yes');
      expect(template({ addons: [], globalAddons: [] })).toBe('no');
    });

    test('checks stack existence in apps', () => {
      const template = Handlebars.compile('{{#if (has "stack" "nextjs")}}yes{{else}}no{{/if}}');
      expect(template({ apps: [{ stackName: 'nextjs' }, { stackName: 'hono' }] })).toBe('yes');
      expect(template({ apps: [{ stackName: 'hono' }] })).toBe('no');
    });

    test('returns false for unknown category', () => {
      const template = Handlebars.compile('{{#if (has "unknown" "value")}}yes{{else}}no{{/if}}');
      expect(template({})).toBe('no');
    });
  });

  describe('hasAddon', () => {
    test('returns true for per-app addon', () => {
      const template = Handlebars.compile('{{#if (hasAddon "shadcn")}}yes{{else}}no{{/if}}');
      expect(template({ addons: ['shadcn'] })).toBe('yes');
    });

    test('returns true for global addon', () => {
      const template = Handlebars.compile('{{#if (hasAddon "drizzle")}}yes{{else}}no{{/if}}');
      expect(template({ globalAddons: ['drizzle'] })).toBe('yes');
    });

    test('returns false when addon not present', () => {
      const template = Handlebars.compile('{{#if (hasAddon "prisma")}}yes{{else}}no{{/if}}');
      expect(template({ addons: [], globalAddons: [] })).toBe('no');
    });
  });

  describe('hasContext', () => {
    test('returns true when context has key with value', () => {
      const template = Handlebars.compile('{{#if (hasContext "globalAddons")}}yes{{else}}no{{/if}}');
      expect(template({ globalAddons: ['drizzle'] })).toBe('yes');
    });

    test('returns false when context key is undefined', () => {
      const template = Handlebars.compile('{{#if (hasContext "globalAddons")}}yes{{else}}no{{/if}}');
      expect(template({})).toBe('no');
    });
  });

  describe('appPort', () => {
    test('returns 3000 for first app', () => {
      const template = Handlebars.compile('{{appPort "web"}}');
      expect(template({ apps: [{ appName: 'web' }, { appName: 'api' }] })).toBe('3000');
    });

    test('returns 3001 for second app', () => {
      const template = Handlebars.compile('{{appPort "api"}}');
      expect(template({ apps: [{ appName: 'web' }, { appName: 'api' }] })).toBe('3001');
    });

    test('returns 3000 for unknown app', () => {
      const template = Handlebars.compile('{{appPort "unknown"}}');
      expect(template({ apps: [{ appName: 'web' }] })).toBe('3000');
    });
  });

  describe('databaseUrl', () => {
    test('returns postgres URL', () => {
      const template = Handlebars.compile('{{databaseUrl}}');
      expect(template({ globalAddons: ['postgres'], projectName: 'test' })).toBe(
        'postgresql://postgres:password@localhost:5432/postgres-test',
      );
    });

    test('returns mysql URL', () => {
      const template = Handlebars.compile('{{databaseUrl}}');
      expect(template({ globalAddons: ['mysql'], projectName: 'test' })).toBe(
        'mysql://mysql:password@localhost:3306/mysql-test',
      );
    });

    test('returns null for no database', () => {
      const template = Handlebars.compile('{{databaseUrl}}');
      expect(template({ globalAddons: [], projectName: 'test' })).toBe('');
    });
  });
});
