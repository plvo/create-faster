import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const ENTER = '\r';
const SPACE = ' ';

const PROMPT_SCRIPT = `
import { promptProjectCategory } from '@/prompts/stack-prompts';
const selected = await promptProjectCategory('tooling', {});
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

describe('promptProjectCategory on a multi-select category', () => {
  test('prints none when nothing is selected', async () => {
    const output = await answer([ENTER]);

    expect(output).toContain('none');
    expect(output).toContain('ANSWER=[]');
  });

  test('prints the selection instead of none', async () => {
    const output = await answer([SPACE, ENTER]);

    expect(output).not.toContain('none');
    expect(output).toContain('ANSWER=["husky"]');
  });
});
