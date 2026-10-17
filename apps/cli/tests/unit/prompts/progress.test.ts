import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { ENTER, type Keystroke, runOnPseudoTerminal } from './pseudo-terminal';

const [blueprintName, blueprint] = Object.entries(META.blueprints)[0] ?? [];
if (!blueprintName || !blueprint) throw new Error('META has no blueprint');

const PROMPT_SCRIPT = `
import { promptForContext } from '@/cli';
const ctx = await promptForContext({ blueprint: ${JSON.stringify(blueprintName)} });
console.log('ANSWER=' + JSON.stringify(ctx.project));
`;

const PROJECT_NAME_PROMPT = 1;
const GIT_PROMPT = 1;
const PACKAGE_MANAGER_PROMPT = 1;
const categoriesAsked = (['deployment', 'linter', 'tooling'] as const).filter(
  (category) => !(category in blueprint.context.project),
);
const promptCount = PROJECT_NAME_PROMPT + categoriesAsked.length + GIT_PROMPT + PACKAGE_MANAGER_PROMPT;

describe('the progress of the blueprint flow', () => {
  test('numbers each prompt asked over the number of prompts asked', async () => {
    const answerEveryPrompt: Keystroke[] = Array.from({ length: promptCount }, (_, i) => ({
      after: `${i + 1}/${promptCount}`,
      send: ENTER,
    }));

    const output = await runOnPseudoTerminal(PROMPT_SCRIPT, answerEveryPrompt);

    expect(output).toContain('ANSWER=');
    const counters = [...output.matchAll(/(\d+)\/(\d+) \d+%/g)].map(([, position, total]) => `${position}/${total}`);
    expect(new Set(counters)).toEqual(new Set(Array.from({ length: promptCount }, (_, i) => `${i + 1}/${promptCount}`)));
  });
});

describe('the progress of the app flow', () => {
  const categoryCount = Object.keys(META.project).length;
  const ORM_PROMPT_DROPPED_WITHOUT_DATABASE = 1;
  const CREATION_MODE_PROMPT = 1;
  const promptsAnswered =
    CREATION_MODE_PROMPT + PROJECT_NAME_PROMPT + 1 /* app count */ + 2 /* stack, libraries */ + categoryCount - ORM_PROMPT_DROPPED_WITHOUT_DATABASE + GIT_PROMPT + PACKAGE_MANAGER_PROMPT;

  test('drops the orm prompt from the total once no database is chosen, and never skips a number', async () => {
    const answerEveryPrompt: Keystroke[] = Array.from({ length: promptsAnswered }, (_, i) => ({
      after: `${i + 1}/`,
      send: ENTER,
    }));

    const output = await runOnPseudoTerminal(
      `
      import { promptForContext } from '@/cli';
      const ctx = await promptForContext({});
      console.log('ANSWER=' + JSON.stringify(ctx.project));
      `,
      answerEveryPrompt,
    );

    expect(output).toContain('ANSWER=');
    const counters = [...output.matchAll(/(\d+)\/(\d+) \d+%/g)].map(([, position, total]) => [Number(position), Number(total)]);
    const positions = [...new Set(counters.map(([position]) => position))];
    expect(positions).toEqual(Array.from({ length: promptsAnswered }, (_, i) => i + 1));
    const totals = counters.map(([, total]) => total);
    expect(totals).toEqual([...totals].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(counters.at(0)?.[1]).toBe(promptsAnswered + ORM_PROMPT_DROPPED_WITHOUT_DATABASE);
    expect(counters.at(-1)).toEqual([promptsAnswered, promptsAnswered]);
  });

  test('keeps the total while the orm prompt follows a chosen database', async () => {
    const DOWN = '\x1b[B';
    const databasePosition = CREATION_MODE_PROMPT + PROJECT_NAME_PROMPT + 1 + 2 + 1 + 1;
    const promptsWithOrm = promptsAnswered + ORM_PROMPT_DROPPED_WITHOUT_DATABASE;
    const answerEveryPrompt: Keystroke[] = Array.from({ length: promptsWithOrm }, (_, i) =>
      i + 1 === databasePosition
        ? [
            { after: `${i + 1}/`, send: DOWN },
            { send: ENTER },
          ]
        : [{ after: `${i + 1}/`, send: ENTER }],
    ).flat();

    const output = await runOnPseudoTerminal(
      `
      import { promptForContext } from '@/cli';
      const ctx = await promptForContext({});
      console.log('ANSWER=' + JSON.stringify(ctx.project));
      `,
      answerEveryPrompt,
    );

    expect(output).toContain('"database":"postgres"');
    const totals = new Set([...output.matchAll(/\d+\/(\d+) \d+%/g)].map(([, total]) => total));
    expect(totals).toEqual(new Set([String(promptsWithOrm)]));
  });
});
