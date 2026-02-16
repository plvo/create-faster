import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, log } from '@clack/prompts';
import color from 'picocolors';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isProjectCategoryAvailable, isRequirementMet } from '@/lib/addon-utils';
import { promptConfirm, promptSelect, promptText } from '@/prompts/base-prompts';
import { multiselectLibrariesPrompt, promptProjectCategory, selectStackPrompt } from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';
import { S_GRAY_BAR } from './tui/symbols';

export async function cli(partial?: Partial<TemplateContext>): Promise<Omit<TemplateContext, 'repo'>> {
  const progress = new Progress(['Project', 'Apps', 'Database', 'Extras', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    project: { tooling: [] },
    git: false,
  };

  if (partial?.projectName) {
    ctx.projectName = partial.projectName;
    log.info(`${color.green('✓')} Using project name: ${color.bold(partial.projectName)}`);
    const fullPath = join(process.cwd(), partial.projectName);
    if (existsSync(fullPath)) {
      cancel(`Directory "${partial.projectName}" already exists.`);
      process.exit(1);
    }
  } else {
    ctx.projectName = await promptText<string>(progress.message('Name of your project?'), {
      placeholder: 'my-app',
      initialValue: 'my-app',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'Project name is required';
        const fullPath = join(process.cwd(), trimmed);
        if (existsSync(fullPath)) {
          return `Directory "${trimmed}" already exists.`;
        }
      },
    });
  }
  progress.next();

  if (partial?.apps && partial.apps.length > 0) {
    ctx.apps = partial.apps;
    log.info(
      `${color.green('✓')} Using ${partial.apps.length} app(s): ${partial.apps.map((a) => a.appName).join(', ')}`,
    );
  } else {
    const appCount = await promptText<number>(
      `${progress.message('How many apps?')}
${S_GRAY_BAR}  ${color.italic(color.gray('Multiple apps = Turborepo monorepo'))}`,
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

  const hasAnyFlags = partial && Object.keys(partial).length > 0;

  if (hasAnyFlags) {
    if (partial?.project) {
      ctx.project = partial.project;
    }
    const parts: string[] = [];
    if (ctx.project.database) parts.push(`database: ${ctx.project.database}`);
    if (ctx.project.orm) parts.push(`orm: ${ctx.project.orm}`);
    if (ctx.project.linter) parts.push(`linter: ${ctx.project.linter}`);
    if (ctx.project.tooling.length > 0) parts.push(`tooling: ${ctx.project.tooling.join(', ')}`);
    if (parts.length > 0) {
      log.info(`${color.green('✓')} Using project config: ${parts.join(', ')}`);
    }
  } else {
    for (const categoryName of Object.keys(META.project) as ProjectCategoryName[]) {
      if (!isProjectCategoryAvailable(categoryName, ctx)) {
        continue;
      }

      const result = await promptProjectCategory(categoryName);

      switch (categoryName) {
        case 'database':
          ctx.project.database = result as string | undefined;
          progress.next();
          break;
        case 'orm':
          ctx.project.orm = result as string | undefined;
          break;
        case 'linter':
          ctx.project.linter = result as string | undefined;
          break;
        case 'tooling':
          ctx.project.tooling = (result as string[]) ?? [];
          break;
      }
    }
  }
  progress.next();

  if (partial?.git !== undefined) {
    ctx.git = partial.git;
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled`);
    }
  } else {
    ctx.git = await promptConfirm(progress.message(`Initialize ${color.bold('Git')}?`), {
      initialValue: true,
    });
  }

  filterToolingByRequirements(ctx);

  if (partial?.pm !== undefined) {
    ctx.pm = partial.pm;
  }

  if (partial?.skipInstall) {
    ctx.skipInstall = true;
    log.info(`${color.green('✓')} Skipping dependency installation`);
    if (partial.pm) {
      log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
    }
  } else if (partial?.pm !== undefined) {
    log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
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

function filterToolingByRequirements(ctx: Omit<TemplateContext, 'repo'>): void {
  const filtered = ctx.project.tooling.filter((toolingName) => {
    const addon = META.project.tooling.options[toolingName];
    if (!addon) return false;

    if (!isRequirementMet(addon.require, ctx as TemplateContext)) {
      log.warn(`${toolingName} requires git. Skipping.`);
      return false;
    }
    return true;
  });

  ctx.project.tooling = filtered;
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
    appName = await promptText<string>(progress.message(`Name of app ${color.bold(`#${index}`)}?`), {
      defaultValue: `app-${index}`,
      placeholder: `app-${index}`,
      validate: (value) => {
        if (!value.trim()) return 'App name is required';
      },
    });
  }

  const stackName = (await selectStackPrompt(progress.message(`Stack for ${color.bold(appName)}`))) as StackName;

  const metaStack = META.stacks[stackName];
  if (!metaStack) {
    cancel(`Stack "${stackName}" not found`);
    process.exit(0);
  }

  const libraries = await multiselectLibrariesPrompt(
    stackName,
    progress.message(`Add ${color.bold(metaStack.label)} libraries to ${color.bold(appName)}?`),
    false,
  );

  return { appName, stackName, libraries };
}
