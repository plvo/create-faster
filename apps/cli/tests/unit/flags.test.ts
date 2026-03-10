import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('META blueprint structure validation', () => {
  test('all blueprints have required fields', () => {
    for (const [name, bp] of Object.entries(META.blueprints)) {
      expect(bp.label, `${name} must have label`).toBeDefined();
      expect(bp.category, `${name} must have category`).toBeDefined();
      expect(typeof bp.category, `${name} category must be a string`).toBe('string');
      expect(bp.context, `${name} must have context`).toBeDefined();
      expect(bp.context.apps.length, `${name} must have at least one app`).toBeGreaterThan(0);
    }
  });

  test('blueprint context.project does not contain linter or tooling', () => {
    for (const [name, bp] of Object.entries(META.blueprints)) {
      const project = bp.context.project as Record<string, unknown>;
      expect(project, `${name} must have context.project`).toBeDefined();
      expect('linter' in project, `${name} context.project should not have linter`).toBe(false);
      expect('tooling' in project, `${name} context.project should not have tooling`).toBe(false);
    }
  });
});
