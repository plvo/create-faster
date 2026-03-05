import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

describe('META blueprint structure validation', () => {
  test('all blueprints have required fields', () => {
    for (const [name, bp] of Object.entries(META.blueprints)) {
      expect(bp.label, `${name} must have label`).toBeDefined();
      expect(bp.context, `${name} must have context`).toBeDefined();
      expect(bp.context.apps.length, `${name} must have at least one app`).toBeGreaterThan(0);
    }
  });
});
