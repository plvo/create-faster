import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/prompts/base-prompts';
import { multiselectModulesPrompt, selectStackPrompt } from '@/prompts/stack-prompts';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { S_GRAY_BAR } from './lib/tui';

export async function cli(): Promise<Omit<TemplateContext, 'repo'>> {
  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    git: false,
  };

  ctx.projectName = await promptText<string>('Name of your project?', {
    placeholder: 'my-app',
    initialValue: 'my-app',
    validate: (value) => {
      const trimedValue = value.trim();
      if (!value || trimedValue === '') return 'Project name is required';
      const fullPath = join(process.cwd(), trimedValue);
      try {
        if (existsSync(fullPath)) {
          return `A file or directory named "${trimedValue}" already exists. Please choose a different name.`;
        }
      } catch (e) {
        return `An error occurred while checking if the app name is valid: ${(e as Error).message}`;
      }
    },
  });

  const appCount = await promptText<number>(
    `How many apps do you want to create?
    ${S_GRAY_BAR}  ${color.italic(color.gray('Eg: a backend + a frontend = enter 2'))}
    ${S_GRAY_BAR}  ${color.italic(color.gray('Only a Next.js app = enter 1'))}
    ${S_GRAY_BAR}  ${color.italic(color.gray('Turborepo will be used if more than one'))}`,
    {
      initialValue: '1',
      placeholder: 'Enter a number',
      validate: (value) => {
        const num = Number(value);
        if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
      },
    },
  );

  ctx.apps = await promptAllApps(Number(appCount), ctx.projectName);
  ctx.database = await promptSelect('database', `Include a ${color.bold('database')}?`, ctx, { allowNone: true });
  ctx.orm = await promptSelect('orm', `Configure an ${color.bold('ORM')}?`, ctx, { allowNone: true });
  ctx.git = await promptConfirm(`Initialize ${color.bold('Git')}?`, { initialValue: true });
  ctx.extras = await promptMultiselect('extras', `Add any ${color.bold('extras')}?`, ctx, { required: false });
  ctx.pm = await promptSelect(undefined, `Install dependencies ${color.bold('now')}?`, ctx, {
    options: [
      { label: 'Install with bun', value: 'bun' },
      { label: 'Install with pnpm', value: 'pnpm' },
      { label: 'Install with npm', value: 'npm' },
      { label: 'Skip installation', value: undefined },
    ],
  });

  return ctx;
}

async function promptAllApps(count: number, projectName: string): Promise<AppContext[]> {
  if (count <= 1) {
    const app = await promptApp(1, projectName);
    return [app];
  }

  const apps: AppContext[] = [];
  for (let i = 0; i < count; i++) {
    const app = await promptApp(i + 1);
    apps.push(app);
  }
  return apps;
}

async function promptApp(index: number, projectNameIfOneApp?: string): Promise<AppContext> {
  let appName = '';

  if (projectNameIfOneApp) {
    appName = projectNameIfOneApp;
  } else {
    appName = await promptText<string>(`Name of the app ${color.bold(`#${index}`)}?`, {
      defaultValue: `app-${index}`,
      placeholder: `app-${index}`,
      validate: (value) => {
        const trimedValue = value.trim();
        if (!value || trimedValue === '') return 'App name is required';
      },
    });
  }

  const stackName = await selectStackPrompt(`Select the stack for ${color.bold(appName)}`);

  const metaStack = META.stacks[stackName];

  if (!metaStack) {
    cancel(`Stack "${stackName}" not found`);
    process.exit(0);
  }

  const modules = await multiselectModulesPrompt(
    metaStack.modules ?? {},
    `Do you want to add any ${color.bold(metaStack.label)} modules to ${color.bold(appName)}?`,
    false,
  );

  return { appName, stackName, modules };
}
