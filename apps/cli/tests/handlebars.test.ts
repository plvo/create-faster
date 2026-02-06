// ABOUTME: Unit tests for Handlebars helpers
// ABOUTME: Tests helpers for libraries and project context

import { beforeAll, describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from '../src/lib/handlebars';
import type { EnrichedTemplateContext } from '../src/types/ctx';

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
      const template = Handlebars.compile('{{#if (isMono)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'turborepo' })).toBe('yes');
    });

    test('returns false for single', () => {
      const template = Handlebars.compile('{{#if (isMono)}}yes{{else}}no{{/if}}');
      expect(template({ repo: 'single' })).toBe('no');
    });
  });

  describe('hasLibrary', () => {
    test('returns true when library exists', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        libraries: ['shadcn', 'mdx'],
      };
      expect(template(ctx)).toBe('yes');
    });

    test('returns false when library does not exist', () => {
      const template = Handlebars.compile('{{#if (hasLibrary "shadcn")}}yes{{else}}no{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        libraries: ['mdx'],
      };
      expect(template(ctx)).toBe('no');
    });
  });

  describe('has', () => {
    test('checks database value', () => {
      const template = Handlebars.compile('{{#if (has "database" "postgres")}}yes{{else}}no{{/if}}');
      expect(template({ project: { database: 'postgres', tooling: [] } })).toBe('yes');
      expect(template({ project: { database: 'mysql', tooling: [] } })).toBe('no');
    });

    test('checks orm value', () => {
      const template = Handlebars.compile('{{#if (has "orm" "drizzle")}}yes{{else}}no{{/if}}');
      expect(template({ project: { orm: 'drizzle', tooling: [] } })).toBe('yes');
      expect(template({ project: { orm: 'prisma', tooling: [] } })).toBe('no');
    });

    test('checks tooling array', () => {
      const template = Handlebars.compile('{{#if (has "tooling" "biome")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: ['biome', 'husky'] } })).toBe('yes');
      expect(template({ project: { tooling: ['husky'] } })).toBe('no');
    });

    test('checks stack existence in apps', () => {
      const template = Handlebars.compile('{{#if (has "stack" "nextjs")}}yes{{else}}no{{/if}}');
      expect(template({ apps: [{ stackName: 'nextjs' }, { stackName: 'hono' }] })).toBe('yes');
      expect(template({ apps: [{ stackName: 'hono' }] })).toBe('no');
    });

    test('returns false for unknown category', () => {
      const template = Handlebars.compile('{{#if (has "unknown" "value")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: [] } })).toBe('no');
    });
  });

  describe('direct project access', () => {
    test('can access project.database directly', () => {
      const template = Handlebars.compile('{{#if project.database}}{{project.database}}{{else}}none{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        project: { database: 'postgres', tooling: [] },
      };
      expect(template(ctx)).toBe('postgres');
    });

    test('can check if project.orm exists', () => {
      const template = Handlebars.compile('{{#if project.orm}}has orm{{else}}no orm{{/if}}');
      const ctx: Partial<EnrichedTemplateContext> = {
        project: { tooling: [] },
      };
      expect(template(ctx)).toBe('no orm');
    });
  });

  describe('hasContext', () => {
    test('returns true when context has key with value', () => {
      const template = Handlebars.compile('{{#if (hasContext "project")}}yes{{else}}no{{/if}}');
      expect(template({ project: { tooling: [] } })).toBe('yes');
    });

    test('returns false when context key is undefined', () => {
      const template = Handlebars.compile('{{#if (hasContext "project")}}yes{{else}}no{{/if}}');
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
});
