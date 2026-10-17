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
  expectedCategoryPrompts,
  isGitPrompted,
  isPackageManagerPrompted,
  isProjectDirAnswered,
  promptModeOf,
  shouldPromptCategory,
} from '@/lib/project-prompts';
import { promptConfirm, promptSelectWithDisabled, promptText } from '@/prompts/base-prompts';
import {
  getCompatibleLibraryNames,
  multiselectLibrariesPrompt,
  promptProjectCategory,
  selectStackPrompt,
} from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, FlagAnswers, PackageManager, ProjectContext, TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { validateRequirements } from './flags';
import { S_GRAY_BAR } from './tui/symbols';

const DEFAULT_PROJECT_NAME = 'my-app';

const PROJECT_NAME_PROMPT = 'project-name';
const APP_COUNT_PROMPT = 'app-count';
const GIT_PROMPT = 'git';
const PACKAGE_MANAGER_PROMPT = 'package-manager';
const BLUEPRINT_CATEGORIES: ProjectCategoryName[] = ['deployment', 'linter', 'tooling'];

const categoryPromptId = (categoryName: ProjectCategoryName) => `category:${categoryName}`;
const appPromptId = (index: number, prompt: 'name' | 'stack' | 'libraries') => `app:${index}:${prompt}`;

/** What the flow knows of the apps it is asking for: how many, and the stack of each one asked so far. */
interface AppsFlow {
  count: number;
  stacks: StackName[];
}

function unaskedCategoryPrompts(
  categoryNames: ProjectCategoryName[],
  ctx: Omit<TemplateContext, 'repo'>,
  mode: ReturnType<typeof promptModeOf>,
  progress: Progress,
): string[] {
  const unasked = categoryNames.filter((categoryName) => !progress.hasAsked(categoryPromptId(categoryName)));
  return expectedCategoryPrompts(unasked, ctx, mode).map(categoryPromptId);
}

function expectedAppPrompts({ count, stacks }: AppsFlow): string[] {
  return Array.from({ length: count }, (_, index) => {
    const stackName = stacks[index];
    const asksLibraries = stackName === undefined || getCompatibleLibraryNames(stackName).length > 0;
    return [
      ...(count > 1 ? [appPromptId(index, 'name')] : []),
      appPromptId(index, 'stack'),
      ...(asksLibraries ? [appPromptId(index, 'libraries')] : []),
    ];
  }).flat();
}

export async function cli(partial?: FlagAnswers): Promise<Omit<TemplateContext, 'repo'>> {
  const mode = promptModeOf(partial);
  const categoryNames = Object.keys(META.project) as ProjectCategoryName[];
  const appsFlow: AppsFlow = { count: 1, stacks: [] };

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    project: partial?.project ? { ...partial.project, tooling: [...partial.project.tooling] } : { tooling: [] },
    git: false,
  };

  const progress: Progress = new Progress(() => [
    ...(isProjectDirAnswered(partial) ? [] : [PROJECT_NAME_PROMPT]),
    ...(areAppsAnswered(partial) ? [] : [APP_COUNT_PROMPT, ...expectedAppPrompts(appsFlow)]),
    ...unaskedCategoryPrompts(categoryNames, ctx, mode, progress),
    ...(isGitPrompted(partial, mode) ? [GIT_PROMPT] : []),
    ...(isPackageManagerPrompted(partial, mode) ? [PACKAGE_MANAGER_PROMPT] : []),
  ]);

  Object.assign(
    ctx,
    await promptOrUseProjectName(partial, () => progress.message(PROJECT_NAME_PROMPT, 'Name of your project?')),
  );

  if (areAppsAnswered(partial)) {
    ctx.apps = partial.apps;
    log.info(
      `${color.green('✓')} Using ${partial.apps.length} app(s): ${partial.apps.map((a) => a.appName).join(', ')}`,
    );
  } else {
    const appCount = await promptText<number>(
      `${progress.message(APP_COUNT_PROMPT, 'How many apps?')}
${S_GRAY_BAR}  ${color.italic(color.gray('Multiple apps = Turborepo monorepo'))}`,
      {
        defaultValue: '1',
        placeholder: '1',
        validate: (value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
        },
      },
    );
    appsFlow.count = Number(appCount);

    ctx.apps = await promptAllApps(appsFlow, ctx.projectName, progress);
  }

  logProjectConfig(ctx.project);
  await promptUnansweredCategories(ctx, categoryNames, partial, progress);

  ctx.git = await promptOrUseGit(partial, () => progress.message(GIT_PROMPT, `Initialize ${color.bold('Git')}?`));

  validateRequirements(partial ?? {}, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(partial, () =>
    progress.message(PACKAGE_MANAGER_PROMPT, `Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial?.agentContext === false) ctx.agentContext = false;

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

  const mode = promptModeOf(partial);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: blueprint.context.apps.map((app) => ({ ...app })),
    project: {
      ...blueprint.context.project,
      ...(partial?.project?.deployment && { deployment: partial.project.deployment }),
      ...(partial?.project?.linter && { linter: partial.project.linter }),
      tooling: partial?.project?.tooling ?? [],
    },
    git: false,
    blueprint: blueprintName,
  };

  const progress: Progress = new Progress(() => [
    ...(isProjectDirAnswered(partial) ? [] : [PROJECT_NAME_PROMPT]),
    ...unaskedCategoryPrompts(BLUEPRINT_CATEGORIES, ctx, mode, progress),
    ...(isGitPrompted(partial, mode) ? [GIT_PROMPT] : []),
    ...(isPackageManagerPrompted(partial, mode) ? [PACKAGE_MANAGER_PROMPT] : []),
  ]);

  Object.assign(
    ctx,
    await promptOrUseProjectName(partial, () => progress.message(PROJECT_NAME_PROMPT, 'Name of your project?')),
  );

  log.info(`${color.green('✓')} Using blueprint: ${color.bold(blueprint.label)}`);
  log.info(
    `${color.gray('  Stack:')} ${ctx.apps.map((a) => `${a.appName} (${META.stacks[a.stackName as StackName]?.label})`).join(', ')}`,
  );

  if (partial?.project?.deployment) {
    log.info(`${color.green('✓')} Using deployment: ${color.bold(partial.project.deployment)}`);
  }

  if (partial?.project?.linter) {
    log.info(`${color.green('✓')} Using linter: ${color.bold(partial.project.linter)}`);
  }

  if (partial?.project?.tooling && partial.project.tooling.length > 0) {
    log.info(`${color.green('✓')} Using tooling: ${color.bold(partial.project.tooling.join(', '))}`);
  }

  await promptUnansweredCategories(ctx, BLUEPRINT_CATEGORIES, partial, progress);

  ctx.git = await promptOrUseGit(partial, () => progress.message(GIT_PROMPT, `Initialize ${color.bold('Git')}?`));

  validateRequirements(partial ?? {}, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(partial, () =>
    progress.message(PACKAGE_MANAGER_PROMPT, `Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial?.agentContext === false) ctx.agentContext = false;

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
  progress: Progress,
): Promise<void> {
  const mode = promptModeOf(partial);

  for (const categoryName of categoryNames) {
    if (shouldPromptCategory(categoryName, ctx, mode)) {
      const result = await promptProjectCategory(
        categoryName,
        ctx,
        progress.message(categoryPromptId(categoryName), META.project[categoryName].prompt),
      );

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
  }
}

async function promptOrUseProjectName(
  partial: FlagAnswers | undefined,
  message: () => string,
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

  const answer = await promptText<string>(message(), {
    placeholder: DEFAULT_PROJECT_NAME,
    defaultValue: DEFAULT_PROJECT_NAME,
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

async function promptOrUseGit(partial: FlagAnswers | undefined, message: () => string): Promise<boolean> {
  if (partial?.git !== undefined) {
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled`);
    }
    return partial.git;
  }

  if (!isGitPrompted(partial, promptModeOf(partial))) return false;

  return promptConfirm(message(), { initialValue: true });
}

async function promptOrUsePackageManager(
  partial: FlagAnswers | undefined,
  message: () => string,
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

  if (!isPackageManagerPrompted(partial, promptModeOf(partial))) return { pm: undefined };

  const pm = await promptSelectWithDisabled<PackageManager>(message(), [
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

async function promptAllApps(appsFlow: AppsFlow, projectName: string, progress: Progress): Promise<AppContext[]> {
  if (appsFlow.count <= 1) {
    return [await promptApp(0, appsFlow, progress, projectName)];
  }

  const apps: AppContext[] = [];
  for (let index = 0; index < appsFlow.count; index++) {
    apps.push(await promptApp(index, appsFlow, progress));
  }
  return apps;
}

async function promptApp(
  index: number,
  appsFlow: AppsFlow,
  progress: Progress,
  projectNameIfOneApp?: string,
): Promise<AppContext> {
  let appName = '';

  if (projectNameIfOneApp) {
    appName = projectNameIfOneApp;
  } else {
    appName = await promptText<string>(
      progress.message(appPromptId(index, 'name'), `Name of app ${color.bold(`#${index + 1}`)}?`),
      {
        defaultValue: `app-${index + 1}`,
        placeholder: `app-${index + 1}`,
        validate: validateAppName,
      },
    );
  }

  const stackName = (await selectStackPrompt(
    progress.message(appPromptId(index, 'stack'), `Stack for ${color.bold(appName)}`),
  )) as StackName;
  appsFlow.stacks[index] = stackName;

  const metaStack = META.stacks[stackName];

  const libraries =
    getCompatibleLibraryNames(stackName).length > 0
      ? await multiselectLibrariesPrompt(
          stackName,
          progress.message(
            appPromptId(index, 'libraries'),
            `Add ${color.bold(metaStack.label)} libraries to ${color.bold(appName)}?`,
          ),
          false,
        )
      : [];

  return { appName, stackName, libraries };
}
