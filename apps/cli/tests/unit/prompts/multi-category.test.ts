import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { META } from '@/__meta__';

const ENTER = '\r';
const SPACE = ' ';
const WAIT_TIMEOUT_MS = 10_000;

const [firstName, firstOption] = Object.entries(META.project.tooling.options)[0] ?? [];
if (!firstName || !firstOption) throw new Error('META.project.tooling has no option');
const firstLabel = firstOption.label;

const PROMPT_SCRIPT = `
import { promptProjectCategory } from '@/prompts/stack-prompts';
const selected = await promptProjectCategory('tooling', {});
console.log('ANSWER=' + JSON.stringify(selected));
`;

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the prompt did not print what the test waits for');
    await Bun.sleep(10);
  }
}

/** Runs the prompt on a pseudo-terminal, sending each key once the prompt has printed what precedes it. */
async function answer(selectFirstOption: boolean): Promise<string> {
  let output = '';
  const prompt = Bun.spawn(['bun', '-e', PROMPT_SCRIPT], {
    cwd: join(import.meta.dir, '../../..'),
    terminal: {
      cols: 100,
      rows: 30,
      data: (_terminal, chunk) => {
        output += new TextDecoder().decode(chunk);
      },
    },
  });

  try {
    await waitFor(() => output.includes(firstLabel));
    if (selectFirstOption) {
      const printedBefore = output.length;
      prompt.terminal?.write(SPACE);
      await waitFor(() => output.length > printedBefore);
    }
    prompt.terminal?.write(ENTER);
    await prompt.exited;
  } finally {
    prompt.kill();
  }
  return output;
}

describe('promptProjectCategory on a multi-select category', () => {
  test('prints none when nothing is selected', async () => {
    const output = await answer(false);

    expect(output).toContain('none');
    expect(output).toContain('ANSWER=[]');
  });

  test('prints the selection instead of none', async () => {
    const output = await answer(true);

    expect(output).not.toContain('none');
    expect(output).toContain(`ANSWER=${JSON.stringify([firstName])}`);
  });
});
