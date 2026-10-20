import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { type DisableableChoice, promptSelectWithDisabled } from '@/prompts/base-prompts';

const DOWN = '\x1b[B';
const ENTER = '\r';

const CHOICES = [
  { value: undefined, label: 'None', hint: 'Skip this option' },
  { value: 'a', label: 'Alpha', disabledReason: 'needs a database' },
  { value: 'b', label: 'Bravo', hint: 'the second one' },
];

async function answer(keys: string[], choices: DisableableChoice[] = CHOICES) {
  const input = new PassThrough();
  const output = new PassThrough();
  let frames = '';
  output.on('data', (chunk) => {
    frames += chunk.toString();
  });

  const result = promptSelectWithDisabled('Pick one', choices, { input, output });
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

  test('starts on the first selectable choice when the undefined choice comes last', async () => {
    const installChoices: DisableableChoice[] = [
      { value: 'bun', label: 'Install with bun', disabledReason: 'not installed' },
      { value: 'npm', label: 'Install with npm' },
      { value: 'pnpm', label: 'Install with pnpm' },
      { value: undefined, label: 'Skip installation' },
    ];

    expect((await answer([ENTER], installChoices)).selected).toBe('npm');
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
