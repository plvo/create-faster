import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { ENTER, runScriptOnPseudoTerminal, SPACE } from '../../pseudo-terminal';

const [firstName, firstOption] = Object.entries(META.project.tooling.options)[0] ?? [];
if (!firstName || !firstOption) throw new Error('META.project.tooling has no option');
const firstLabel = firstOption.label;

const PROMPT_SCRIPT = `
import { promptProjectCategory } from '@/prompts/stack-prompts';
const selected = await promptProjectCategory('tooling', {});
console.log('ANSWER=' + JSON.stringify(selected));
`;

async function answer(selectFirstOption: boolean): Promise<string> {
  const { output } = await runScriptOnPseudoTerminal(PROMPT_SCRIPT, [
    ...(selectFirstOption ? [{ prompt: firstLabel, keys: SPACE }] : []),
    { prompt: selectFirstOption ? undefined : firstLabel, keys: ENTER },
  ]);
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
