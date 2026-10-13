import { expect, test } from 'bun:test';
import color from 'picocolors';

test('the test process renders plain text whatever the terminal or CI asks for', () => {
  expect(color.isColorSupported).toBe(false);
  expect(color.red('x')).toBe('x');
});
