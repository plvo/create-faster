import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { promptSelectWithDisabled } from '@/prompts/base-prompts';

const DOWN = '\x1b[B';
const ENTER = '\r';

const CHOICES = [
  { value: undefined, label: 'None', hint: 'Skip this option' },
  { value: 'a', label: 'Alpha', disabledReason: 'needs a database' },
  { value: 'b', label: 'Bravo', hint: 'the second one' },
];

async function answer(keys: string[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  let frames = '';
  output.on('data', (chunk) => {
    frames += chunk.toString();
  });

  const result = promptSelectWithDisabled('Pick one', CHOICES, { input, output });
  for (const key of keys) {
    await Bun.sleep(5);
    input.write(key);
  }
  return { selected: await result, frames };
}

describe('promptSelectWithDisabled', () => {
  test('submits the first selectable choice on enter', async () => {
    expect((await answer([ENTER])).selected).toBeUndefined();
  });

  test('skips a disabled choice when moving the cursor', async () => {
    expect((await answer([DOWN, ENTER])).selected).toBe('b');
  });

  test('renders a disabled choice with its reason and the active choice hint', async () => {
    const { frames } = await answer([DOWN, ENTER]);
    expect(frames).toContain('Alpha');
    expect(frames).toContain('needs a database');
    expect(frames).toContain('the second one');
    expect(frames).toContain('Pick one');
  });
});
