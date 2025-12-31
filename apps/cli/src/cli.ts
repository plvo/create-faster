import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, log } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/prompts/base-prompts';
import { multiselectModulesPrompt, selectStackPrompt } from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, TemplateContext } from '@/types/ctx';
import { S_GRAY_BAR } from './tui/symbols';

export async function cli(partial?: Partial<TemplateContext>): Promise<Omit<TemplateContext, 'repo'>> {
  const progress = new Progress(['Project', 'Apps', 'Database', 'Extras', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    git: false,
  };

  if (partial?.projectName) {
    ctx.projectName = partial.projectName;
    log.info(`${color.green('✓')} Using project name from flags: ${color.bold(partial.projectName)}`);
    const fullPath = join(process.cwd(), partial.projectName);
    if (existsSync(fullPath)) {
      cancel(`A file or directory named "${partial.projectName}" already exists. Please choose a different name.`);
      process.exit(1);
    }
  } else {
    ctx.projectName = await promptText<string>(progress.message('Name of your project?'), {
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
  }
  progress.next();

  // Apps configuration
  if (partial?.apps && partial.apps.length > 0) {
    ctx.apps = partial.apps;
    log.info(
      `${color.green('✓')} Using ${partial.apps.length} app(s) from flags: ${partial.apps.map((a) => a.appName).join(', ')}`,
    );
  } else {
    const appCount = await promptText<number>(
      `${progress.message('How many apps do you want to create?')}
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

    ctx.apps = await promptAllApps(Number(appCount), ctx.projectName, progress);
  }
  progress.next();

  // Database
  if (partial?.database !== undefined) {
    ctx.database = partial.database;
    if (partial.database) {
      log.info(`${color.green('✓')} Using database from flags: ${color.bold(partial.database)}`);
    }
  } else {
    ctx.database = await promptSelect('database', progress.message(`Include a ${color.bold('database')}?`), ctx, {
      allowNone: true,
    });
  }

  // ORM
  if (partial?.orm !== undefined) {
    ctx.orm = partial.orm;
    if (partial.orm) {
      log.info(`${color.green('✓')} Using ORM from flags: ${color.bold(partial.orm)}`);
    }
  } else {
    ctx.orm = await promptSelect('orm', progress.message(`Configure an ${color.bold('ORM')}?`), ctx, {
      allowNone: true,
    });
  }

  progress.next();

  // Git
  if (partial?.git !== undefined) {
    ctx.git = partial.git;
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled from flags`);
    }
  } else {
    ctx.git = await promptConfirm(progress.message(`Initialize ${color.bold('Git')}?`), {
      initialValue: true,
    });
  }

  // Extras
  if (partial?.extras !== undefined) {
    ctx.extras = partial.extras;
    if (partial.extras && partial.extras.length > 0) {
      log.info(`${color.green('✓')} Using extras from flags: ${partial.extras.join(', ')}`);
    }
  } else {
    ctx.extras = await promptMultiselect('extras', progress.message(`Add any ${color.bold('extras')}?`), ctx, {
      required: false,
    });
  }

  progress.next();

  // Package manager
  if (partial?.pm !== undefined) {
    ctx.pm = partial.pm;
    if (partial.pm) {
      log.info(`${color.green('✓')} Using package manager from flags: ${color.bold(partial.pm)}`);
    }
  } else {
    ctx.pm = await promptSelect(undefined, progress.message(`Install dependencies ${color.bold('now')}?`), ctx, {
      options: [
        { label: 'Install with bun', value: 'bun' },
        { label: 'Install with pnpm', value: 'pnpm' },
        { label: 'Install with npm', value: 'npm' },
        { label: 'Skip installation', value: undefined },
      ],
    });
  }

  progress.next();

  return ctx;
}

async function promptAllApps(count: number, projectName: string, progress: Progress): Promise<AppContext[]> {
  if (count <= 1) {
    const app = await promptApp(1, progress, projectName);
    return [app];
  }

  const apps: AppContext[] = [];
  for (let i = 0; i < count; i++) {
    const app = await promptApp(i + 1, progress, undefined);
    apps.push(app);
  }
  return apps;
}

async function promptApp(index: number, progress: Progress, projectNameIfOneApp?: string): Promise<AppContext> {
  let appName = '';

  if (projectNameIfOneApp) {
    appName = projectNameIfOneApp;
  } else {
    appName = await promptText<string>(progress.message(`Name of the app ${color.bold(`#${index}`)}?`), {
      defaultValue: `app-${index}`,
      placeholder: `app-${index}`,
      validate: (value) => {
        const trimedValue = value.trim();
        if (!value || trimedValue === '') return 'App name is required';
      },
    });
  }

  const stackName = await selectStackPrompt(progress.message(`Select the stack for ${color.bold(appName)}`));

  const metaStack = META.stacks[stackName];

  if (!metaStack) {
    cancel(`Stack "${stackName}" not found`);
    process.exit(0);
  }

  const modules = await multiselectModulesPrompt(
    metaStack.modules ?? {},
    progress.message(`Do you want to add any ${color.bold(metaStack.label)} modules to ${color.bold(appName)}?`),
    false,
  );

  return { appName, stackName, modules };
}
