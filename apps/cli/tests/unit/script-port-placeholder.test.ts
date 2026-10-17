import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';

function collectScriptsWithPort(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.includes('{{port}}')) found.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectScriptsWithPort(item, found);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectScriptsWithPort(value, found);
  }
  return found;
}

// A single repo removes the `--port {{port}}` flag and resolves any other `{{port}}` to the app port.
// Every script that carries the placeholder today uses one of these two forms, so the rule changes none of them.
describe('{{port}} in the scripts of META', () => {
  const scripts = collectScriptsWithPort(META);

  test('there are scripts with the placeholder', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test.each(scripts)('%s uses the port flag or the PORT default', (script) => {
    const withoutKnownForms = script.replace(/ --port \{\{port\}\}/g, '').replace(/\$\{PORT:-\{\{port\}\}\}/g, '');
    expect(withoutKnownForms).not.toContain('{{port}}');
  });
});
