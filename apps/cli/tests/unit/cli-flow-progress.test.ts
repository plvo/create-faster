import { describe, expect, test } from 'bun:test';
import { META } from '@/__meta__';
import { DOWN, ENTER, type Keystroke, runScriptOnPseudoTerminal } from '../pseudo-terminal';

const [blueprintName, blueprint] = Object.entries(META.blueprints)[0] ?? [];
if (!blueprintName || !blueprint) throw new Error('META has no blueprint');

const BLUEPRINT_FLOW_SCRIPT = `
import { promptForContext } from '@/cli';
const ctx = await promptForContext({ blueprint: ${JSON.stringify(blueprintName)} });
console.log('ANSWER=' + JSON.stringify(ctx.project));
`;

const APP_FLOW_SCRIPT = `
import { promptForContext } from '@/cli';
const ctx = await promptForContext({});
console.log('ANSWER=' + JSON.stringify(ctx.project));
`;

const CREATION_MODE_PROMPTS = 1;
const PROJECT_NAME_PROMPTS = 1;
const APP_COUNT_PROMPTS = 1;
const PROMPTS_PER_SINGLE_APP = 2;
const GIT_PROMPTS = 1;
const PACKAGE_MANAGER_PROMPTS = 1;
const ORM_PROMPTS = 1;

const counterOf = (output: string) =>
  [...output.matchAll(/(\d+)\/(\d+) \d+%/g)].map(([, position, total]) => [Number(position), Number(total)] as const);

const answerWithEnter = (count: number): Keystroke[] =>
  Array.from({ length: count }, (_, i) => ({ prompt: `${i + 1}/`, keys: ENTER }));

describe('the progress of the blueprint flow', () => {
  const blueprintCategories = (['deployment', 'linter', 'tooling'] as const).filter(
    (category) => !(category in blueprint.context.project),
  );
  const promptCount = PROJECT_NAME_PROMPTS + blueprintCategories.length + GIT_PROMPTS + PACKAGE_MANAGER_PROMPTS;

  test('numbers each prompt asked over the number of prompts asked', async () => {
    const { output } = await runScriptOnPseudoTerminal(BLUEPRINT_FLOW_SCRIPT, answerWithEnter(promptCount));

    expect(output).toContain('ANSWER=');
    const expected = Array.from({ length: promptCount }, (_, i) => [i + 1, promptCount]);
    expect([...new Set(counterOf(output).map(([position, total]) => `${position}/${total}`))]).toEqual(
      expected.map(([position, total]) => `${position}/${total}`),
    );
  });
});

describe('the progress of the app flow', () => {
  const categoryCount = Object.keys(META.project).length;
  const promptsWithoutDatabase =
    CREATION_MODE_PROMPTS +
    PROJECT_NAME_PROMPTS +
    APP_COUNT_PROMPTS +
    PROMPTS_PER_SINGLE_APP +
    (categoryCount - ORM_PROMPTS) +
    GIT_PROMPTS +
    PACKAGE_MANAGER_PROMPTS;
  const promptsWithDatabase = promptsWithoutDatabase + ORM_PROMPTS;

  test('drops the orm prompt from the total once no database is chosen, and never skips a number', async () => {
    const { output } = await runScriptOnPseudoTerminal(APP_FLOW_SCRIPT, answerWithEnter(promptsWithoutDatabase));

    expect(output).toContain('ANSWER=');
    const counters = counterOf(output);
    const positions = [...new Set(counters.map(([position]) => position))];
    expect(positions).toEqual(Array.from({ length: promptsWithoutDatabase }, (_, i) => i + 1));
    const totals = counters.map(([, total]) => total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(totals.at(0)).toBe(promptsWithDatabase);
    expect(counters.at(-1)).toEqual([promptsWithoutDatabase, promptsWithoutDatabase]);
  });

  test('keeps the total while the orm prompt follows a chosen database', async () => {
    const databasePosition =
      CREATION_MODE_PROMPTS + PROJECT_NAME_PROMPTS + APP_COUNT_PROMPTS + PROMPTS_PER_SINGLE_APP + 1 /* deployment */ + 1;
    const answers: Keystroke[] = answerWithEnter(promptsWithDatabase).flatMap((answer, i) =>
      i + 1 === databasePosition ? [{ ...answer, keys: DOWN }, { keys: ENTER }] : [answer],
    );

    const { output } = await runScriptOnPseudoTerminal(APP_FLOW_SCRIPT, answers);

    expect(output).toContain('"database":"postgres"');
    expect(new Set(counterOf(output).map(([, total]) => total))).toEqual(new Set([promptsWithDatabase]));
  });
});
