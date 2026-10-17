import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const ENTER = '\r';
const SPACE = ' ';
const CLEAR_PREVIOUS_LINE = '\x1b[1A\x1b[2K';

const PROMPT_SCRIPT = `
import { promptGroupMultiselect } from '@/prompts/base-prompts';
const selected = await promptGroupMultiselect({
  message: 'Add any extras?',
  options: { Tooling: [{ value: 'husky', label: 'Husky' }] },
  required: false,
  selectableGroups: false,
});
process.stdout.write('\\nANSWER=' + JSON.stringify(selected) + '\\n');
`;

async function answer(keys: string[]): Promise<string> {
  const prompt = Bun.spawn(['bun', '-e', PROMPT_SCRIPT], {
    cwd: join(import.meta.dir, '../../..'),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  for (const key of keys) {
    await Bun.sleep(150);
    prompt.stdin.write(key);
  }
  prompt.stdin.end();
  return new Response(prompt.stdout).text();
}

describe('promptGroupMultiselect', () => {
  test('replaces the blank answer of an empty selection with none', async () => {
    const output = await answer([ENTER]);

    expect(output).toContain(`${CLEAR_PREVIOUS_LINE}│  none`);
    expect(output).toContain('ANSWER=[]');
  });

  test('leaves the answer clack prints for a selection alone', async () => {
    const output = await answer([SPACE, ENTER]);

    expect(output).not.toContain('none');
    expect(output).toContain('ANSWER=["husky"]');
  });
});
