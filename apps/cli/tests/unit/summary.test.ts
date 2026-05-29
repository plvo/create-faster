import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('recreate command', () => {
  test('summary.ts appends --no-agent-context when disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/tui/summary.ts'), 'utf-8');
    expect(src).toContain('--no-agent-context');
  });
});
