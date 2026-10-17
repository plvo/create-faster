import { describe, expect, test } from 'bun:test';
import { ENTER, runScriptOnPseudoTerminal } from '../../pseudo-terminal';

const PROMPT_SCRIPT = `
import { promptText } from '@/prompts/base-prompts';
const answer = await promptText('Name?', {
  defaultValue: 'taken',
  placeholder: 'taken',
  validate: (value) => (value === 'taken' ? 'Already exists' : undefined),
});
console.log('ANSWER=' + JSON.stringify(answer));
`;

describe('promptText with a default value the validation rejects', () => {
  test('reports the error of the default instead of accepting it', async () => {
    const { output } = await runScriptOnPseudoTerminal(PROMPT_SCRIPT, [
      { prompt: 'Name?', keys: ENTER },
      { prompt: 'Already exists', keys: 'x' },
      { keys: ENTER },
    ]);

    expect(output).toContain('Already exists');
    expect(output).toContain('ANSWER="x"');
  });
});
