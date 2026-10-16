import { existsSync } from 'node:fs';
import { cancel, log } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { isRequirementMet } from '@/lib/addon-utils';
import { PACKAGE_MANAGERS } from '@/lib/constants';
import { readPackageManagerVersion } from '@/lib/package-manager';
import { projectNameOf, resolveProjectDir, validateAppName, validateProjectName } from '@/lib/project-location';
import {
  areAppsAnswered,
  arePromptsSuppressed,
  isProjectDirAnswered,
  promptModeOf,
  shouldPromptCategory,
} from '@/lib/project-prompts';
import { promptConfirm, promptSelectWithDisabled, promptText } from '@/prompts/base-prompts';
import { multiselectLibrariesPrompt, promptProjectCategory, selectStackPrompt } from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, FlagAnswers, PackageManager, ProjectContext, TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { validateRequirements } from './flags';
import { S_GRAY_BAR } from './tui/symbols';

export async function cli(partial?: FlagAnswers): Promise<Omit<TemplateContext, 'repo'>> {
  const progress = new Progress(['Project', 'Apps', 'Database', 'Extras', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    project: { tooling: [] },
    git: false,
  };

  Object.assign(ctx, await promptOrUseProjectName(partial, progress.message('Name of your project?')));
  progress.next();

  if (areAppsAnswered(partial)) {
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

  if (partial?.project) {
    ctx.project = { ...partial.project, tooling: [...partial.project.tooling] };
  }
  logProjectConfig(ctx.project);
  await promptUnansweredCategories(ctx, Object.keys(META.project) as ProjectCategoryName[], partial, progress);
  progress.next();

  ctx.git = await promptOrUseGit(partial, progress.message(`Initialize ${color.bold('Git')}?`));

  validateRequirements(partial ?? {}, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(
    partial,
    progress.message(`Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial?.agentContext === false) ctx.agentContext = false;
  progress.next();

  return ctx;
}

export async function blueprintCli(
  blueprintName: string,
  partial?: FlagAnswers,
): Promise<Omit<TemplateContext, 'repo'>> {
  const blueprint = META.blueprints[blueprintName];
  if (!blueprint) {
    cancel(`Blueprint "${blueprintName}" not found`);
    process.exit(1);
  }

  const progress = new Progress(['Project', 'Extras', 'Install']);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: blueprint.context.apps.map((app) => ({ ...app })),
    project: { ...blueprint.context.project, tooling: [] },
    git: false,
    blueprint: blueprintName,
  };

  Object.assign(ctx, await promptOrUseProjectName(partial, progress.message('Name of your project?')));

  log.info(`${color.green('✓')} Using blueprint: ${color.bold(blueprint.label)}`);
  log.info(
    `${color.gray('  Stack:')} ${ctx.apps.map((a) => `${a.appName} (${META.stacks[a.stackName as StackName]?.label})`).join(', ')}`,
  );
  progress.next();

  if (partial?.project?.deployment) {
    ctx.project.deployment = partial.project.deployment;
    log.info(`${color.green('✓')} Using deployment: ${color.bold(partial.project.deployment)}`);
  }

  if (partial?.project?.linter) {
    ctx.project.linter = partial.project.linter;
    log.info(`${color.green('✓')} Using linter: ${color.bold(partial.project.linter)}`);
  }

  if (partial?.project?.tooling && partial.project.tooling.length > 0) {
    ctx.project.tooling = partial.project.tooling;
    log.info(`${color.green('✓')} Using tooling: ${color.bold(partial.project.tooling.join(', '))}`);
  }

  await promptUnansweredCategories(ctx, ['deployment', 'linter', 'tooling'], partial);
  progress.next();

  ctx.git = await promptOrUseGit(partial, progress.message(`Initialize ${color.bold('Git')}?`));

  validateRequirements(partial ?? {}, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(
    partial,
    progress.message(`Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial?.agentContext === false) ctx.agentContext = false;
  progress.next();

  return ctx;
}

function logProjectConfig(project: ProjectContext): void {
  const parts: string[] = [];
  if (project.database) parts.push(`database: ${project.database}`);
  if (project.orm) parts.push(`orm: ${project.orm}`);
  if (project.deployment) parts.push(`deployment: ${project.deployment}`);
  if (project.linter) parts.push(`linter: ${project.linter}`);
  if (project.tooling.length > 0) parts.push(`tooling: ${project.tooling.join(', ')}`);
  if (parts.length > 0) {
    log.info(`${color.green('✓')} Using project config: ${parts.join(', ')}`);
  }
}

async function promptUnansweredCategories(
  ctx: Omit<TemplateContext, 'repo'>,
  categoryNames: ProjectCategoryName[],
  partial: FlagAnswers | undefined,
  progress?: Progress,
): Promise<void> {
  const mode = promptModeOf(partial);

  for (const categoryName of categoryNames) {
    if (shouldPromptCategory(categoryName, ctx, mode)) {
      const result = await promptProjectCategory(categoryName, ctx);

      switch (categoryName) {
        case 'database':
          ctx.project.database = result as string | undefined;
          break;
        case 'orm':
          ctx.project.orm = result as string | undefined;
          break;
        case 'deployment':
          ctx.project.deployment = result as string | undefined;
          break;
        case 'linter':
          ctx.project.linter = result as string | undefined;
          break;
        case 'tooling':
          ctx.project.tooling = (result as string[]) ?? [];
          break;
      }
    }

    if (categoryName === 'database') progress?.next();
  }
}

async function promptOrUseProjectName(
  partial: FlagAnswers | undefined,
  message: string,
): Promise<Pick<TemplateContext, 'projectName' | 'projectDir'>> {
  if (isProjectDirAnswered(partial)) {
    const projectName = projectNameOf(partial.projectDir);
    log.info(`${color.green('✓')} Using project name: ${color.bold(projectName)}`);
    if (existsSync(resolveProjectDir(partial.projectDir))) {
      cancel(`Directory "${partial.projectDir}" already exists.`);
      process.exit(1);
    }
    return { projectName, projectDir: partial.projectDir };
  }

  const answer = await promptText<string>(message, {
    placeholder: 'my-app',
    initialValue: 'my-app',
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return 'Project name is required';
      const nameError = validateProjectName(projectNameOf(trimmed));
      if (nameError) return nameError;
      if (existsSync(resolveProjectDir(trimmed))) {
        return `Directory "${trimmed}" already exists.`;
      }
    },
  });
  const projectDir = answer.trim();
  return { projectName: projectNameOf(projectDir), projectDir };
}

async function promptOrUseGit(partial: FlagAnswers | undefined, message: string): Promise<boolean> {
  if (partial?.git !== undefined) {
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled`);
    }
    return partial.git;
  }

  if (arePromptsSuppressed(promptModeOf(partial))) return false;

  return promptConfirm(message, { initialValue: true });
}

async function promptOrUsePackageManager(
  partial: FlagAnswers | undefined,
  message: string,
): Promise<{ pm?: PackageManager; skipInstall?: boolean }> {
  if (partial?.skipInstall) {
    log.info(`${color.green('✓')} Skipping dependency installation`);
    if (partial.pm) {
      log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
    }
    return { pm: partial.pm, skipInstall: true };
  }

  if (partial?.pm !== undefined) {
    log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
    return { pm: partial.pm };
  }

  if (arePromptsSuppressed(promptModeOf(partial))) return { pm: undefined };

  const pm = await promptSelectWithDisabled<PackageManager>(message, [
    ...PACKAGE_MANAGERS.map((name) => ({
      value: name,
      label: `Install with ${name}`,
      disabledReason: readPackageManagerVersion(name) ? undefined : 'not installed',
    })),
    { value: undefined, label: 'Skip installation' },
  ]);

  return { pm };
}

function filterToolingByRequirements(ctx: Omit<TemplateContext, 'repo'>): void {
  const filtered = ctx.project.tooling.filter((toolingName) => {
    const addon = META.project.tooling.options[toolingName];
    if (!addon) return false;

    if (!isRequirementMet(addon.require, ctx)) {
      const missing: string[] = [];
      if (addon.require?.git && !ctx.git) missing.push('git');
      if (addon.require?.linter && !ctx.project.linter) missing.push('a linter');
      const reason = missing.length > 0 ? missing.join(' and ') : 'unmet requirements';
      log.warn(`${toolingName} requires ${reason}. Skipping.`);
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
        return validateAppName(value);
      },
    });
  }

  const stackName = (await selectStackPrompt(progress.message(`Stack for ${color.bold(appName)}`))) as StackName;

  const metaStack = META.stacks[stackName];

  const libraries = await multiselectLibrariesPrompt(
    stackName,
    progress.message(`Add ${color.bold(metaStack.label)} libraries to ${color.bold(appName)}?`),
    false,
  );

  return { appName, stackName, libraries };
}
