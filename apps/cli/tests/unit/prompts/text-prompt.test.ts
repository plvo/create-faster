import { describe, expect, test } from 'bun:test';
import { ENTER, type Keystroke, runOnPseudoTerminal } from './pseudo-terminal';

const PROMPT_SCRIPT = `
import { promptText } from '@/prompts/base-prompts';
const answer = await promptText('Name?', {
  defaultValue: 'my-app',
  placeholder: 'my-app',
  validate: (value) => (value === 'taken' ? 'Already exists' : undefined),
});
console.log('ANSWER=' + JSON.stringify(answer));
`;

const typed = (text: string): Keystroke[] => [...text].map((send) => ({ send }));

describe('promptText with a default value', () => {
  test('starts empty, so typing does not append to the default', async () => {
    const output = await runOnPseudoTerminal(PROMPT_SCRIPT, [{ after: 'Name?', send: 'f' }, ...typed('oo'), { send: ENTER }]);

    expect(output).toContain('ANSWER="foo"');
  });

  test('uses the default when enter is pressed on an empty value', async () => {
    const output = await runOnPseudoTerminal(PROMPT_SCRIPT, [{ after: 'Name?', send: ENTER }]);

    expect(output).toContain('ANSWER="my-app"');
  });
});

describe('promptText with a default value the validation rejects', () => {
  const script = PROMPT_SCRIPT.replace("defaultValue: 'my-app'", "defaultValue: 'taken'");

  test('reports the error of the default instead of accepting it', async () => {
    const output = await runOnPseudoTerminal(script, [
      { after: 'Name?', send: ENTER },
      { after: 'Already exists', send: 'x' },
      { send: ENTER },
    ]);

    expect(output).toContain('Already exists');
    expect(output).toContain('ANSWER="x"');
  });
});
