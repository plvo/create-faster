import { existsSync } from 'node:fs';
import { cancel, log } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import {
  describeRequire,
  getBlueprintAppContexts,
  getCompatibleLibraryNames,
  isRequirementMet,
} from '@/lib/addon-utils';
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
import { promptConfirm, promptSelect, promptSelectWithDisabled, promptText } from '@/prompts/base-prompts';
import {
  multiselectLibrariesPrompt,
  promptProjectCategory,
  selectBlueprintPrompt,
  selectStackPrompt,
} from '@/prompts/stack-prompts';
import { Progress } from '@/tui/progress';
import type { AppContext, FlagAnswers, PackageManager, ProjectContext, TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';
import { validateRequirements } from './flags';
import { S_GRAY_BAR } from './tui/symbols';

const DEFAULT_PROJECT_NAME = 'my-app';

const CREATION_MODE_PROMPT = 'creation-mode';
const BLUEPRINT_CHOICE_PROMPT = 'blueprint-choice';
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

const asksAppName = (appCount: number) => appCount > 1;
const asksLibraries = (stackName: StackName) => getCompatibleLibraryNames(stackName).length > 0;

function unaskedCategoryPrompts(
  categoryNames: ProjectCategoryName[],
  ctx: Omit<TemplateContext, 'repo'>,
  mode: ReturnType<typeof promptModeOf>,
  progress: Progress,
): string[] {
  const unasked = categoryNames.filter((categoryName) => !progress.hasAsked(categoryPromptId(categoryName)));
  const answering = categoryNames.filter((categoryName) => progress.isCurrent(categoryPromptId(categoryName)));
  return expectedCategoryPrompts(unasked, ctx, mode, answering).map(categoryPromptId);
}

function expectedAppPrompts({ count, stacks }: AppsFlow): string[] {
  return Array.from({ length: count }, (_, index) => {
    const stackName = stacks[index];
    return [
      ...(asksAppName(count) ? [appPromptId(index, 'name')] : []),
      appPromptId(index, 'stack'),
      ...(stackName === undefined || asksLibraries(stackName) ? [appPromptId(index, 'libraries')] : []),
    ];
  }).flat();
}

/** The prompts every flow asks around its own: the project name first, then git and the package manager. */
function plannedPrompts(
  partial: FlagAnswers,
  mode: ReturnType<typeof promptModeOf>,
  ownPrompts: () => string[],
): string[] {
  return [
    ...(isProjectDirAnswered(partial) ? [] : [PROJECT_NAME_PROMPT]),
    ...ownPrompts(),
    ...(isGitPrompted(partial, mode) ? [GIT_PROMPT] : []),
    ...(isPackageManagerPrompted(partial, mode) ? [PACKAGE_MANAGER_PROMPT] : []),
  ];
}

function startCustomFlow(partial: FlagAnswers) {
  const mode = promptModeOf(partial);
  const categoryNames = Object.keys(META.project) as ProjectCategoryName[];
  const appsFlow: AppsFlow = { count: 1, stacks: [] };

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    project: partial.project ? { ...partial.project, tooling: [...partial.project.tooling] } : { tooling: [] },
    git: false,
  };

  const progress: Progress = new Progress(() =>
    plannedPrompts(partial, mode, () => [
      ...(areAppsAnswered(partial) ? [] : [APP_COUNT_PROMPT, ...expectedAppPrompts(appsFlow)]),
      ...unaskedCategoryPrompts(categoryNames, ctx, mode, progress),
    ]),
  );

  return { categoryNames, appsFlow, ctx, progress };
}

function startBlueprintFlow(partial: FlagAnswers, blueprintName: string, alreadyAsked: string[]) {
  const blueprint = META.blueprints[blueprintName];
  if (!blueprint) {
    cancel(`Blueprint "${blueprintName}" not found`);
    process.exit(1);
  }

  const mode = promptModeOf(partial);

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: getBlueprintAppContexts(blueprint),
    project: {
      ...blueprint.context.project,
      ...(partial.project?.deployment && { deployment: partial.project.deployment }),
      ...(partial.project?.linter && { linter: partial.project.linter }),
      tooling: partial.project?.tooling ?? [],
    },
    git: false,
    blueprint: blueprintName,
  };

  const progress: Progress = new Progress(
    () => plannedPrompts(partial, mode, () => unaskedCategoryPrompts(BLUEPRINT_CATEGORIES, ctx, mode, progress)),
    alreadyAsked,
  );

  return { blueprint, ctx, progress };
}

type CustomFlow = ReturnType<typeof startCustomFlow>;

/** Before a template is chosen, only the prompts every template flow asks are known. */
async function promptBlueprint(partial: FlagAnswers): Promise<string> {
  const mode = promptModeOf(partial);
  const progress = new Progress(() => plannedPrompts(partial, mode, () => []), [CREATION_MODE_PROMPT]);
  return selectBlueprintPrompt(progress.message(BLUEPRINT_CHOICE_PROMPT, 'Choose a template:'));
}

/** Runs the prompts that follow the flags: a blueprint when asked for, else the choice between a template and a custom stack. */
export async function promptForContext(partial: FlagAnswers): Promise<Omit<TemplateContext, 'repo'>> {
  if (partial.blueprint) return blueprintCli(partial.blueprint, partial);

  const hasCompositionFlags =
    'apps' in partial ||
    'project' in partial ||
    'git' in partial ||
    'pm' in partial ||
    'skipInstall' in partial ||
    'skipPrompts' in partial;
  const hasBlueprints = Object.keys(META.blueprints).length > 0;
  if (hasCompositionFlags || !hasBlueprints) return cli(partial);

  const customFlow = startCustomFlow(partial);
  const creationMode = await promptSelect<'custom' | 'blueprint'>(
    customFlow.progress.message(CREATION_MODE_PROMPT, 'What would you like to create?'),
    {
      options: [
        { value: 'custom', label: 'Start from scratch', hint: 'Choose your own stack and libraries' },
        { value: 'blueprint', label: 'Use a template', hint: 'Pre-configured project with application code' },
      ],
    },
  );
  if (creationMode === 'custom') return cli(partial, customFlow);

  const blueprintName = await promptBlueprint(partial);
  return blueprintCli(blueprintName, partial, [CREATION_MODE_PROMPT, BLUEPRINT_CHOICE_PROMPT]);
}

async function cli(
  partial: FlagAnswers,
  { categoryNames, appsFlow, ctx, progress }: CustomFlow = startCustomFlow(partial),
): Promise<Omit<TemplateContext, 'repo'>> {
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

  validateRequirements(partial, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(partial, () =>
    progress.message(PACKAGE_MANAGER_PROMPT, `Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial.agentContext === false) ctx.agentContext = false;

  return ctx;
}

async function blueprintCli(
  blueprintName: string,
  partial: FlagAnswers,
  alreadyAsked: string[] = [],
): Promise<Omit<TemplateContext, 'repo'>> {
  const { blueprint, ctx, progress } = startBlueprintFlow(partial, blueprintName, alreadyAsked);

  Object.assign(
    ctx,
    await promptOrUseProjectName(partial, () => progress.message(PROJECT_NAME_PROMPT, 'Name of your project?')),
  );

  log.info(`${color.green('✓')} Using blueprint: ${color.bold(blueprint.label)}`);
  log.info(
    `${color.gray('  Stack:')} ${ctx.apps.map((a) => `${a.appName} (${META.stacks[a.stackName as StackName]?.label})`).join(', ')}`,
  );

  if (partial.project?.deployment) {
    log.info(`${color.green('✓')} Using deployment: ${color.bold(partial.project.deployment)}`);
  }

  if (partial.project?.linter) {
    log.info(`${color.green('✓')} Using linter: ${color.bold(partial.project.linter)}`);
  }

  if (partial.project?.tooling && partial.project.tooling.length > 0) {
    log.info(`${color.green('✓')} Using tooling: ${color.bold(partial.project.tooling.join(', '))}`);
  }

  await promptUnansweredCategories(ctx, BLUEPRINT_CATEGORIES, partial, progress);

  ctx.git = await promptOrUseGit(partial, () => progress.message(GIT_PROMPT, `Initialize ${color.bold('Git')}?`));

  validateRequirements(partial, ctx);
  filterToolingByRequirements(ctx);

  const { pm, skipInstall } = await promptOrUsePackageManager(partial, () =>
    progress.message(PACKAGE_MANAGER_PROMPT, `Install dependencies ${color.bold('now')}?`),
  );
  ctx.pm = pm;
  if (skipInstall) ctx.skipInstall = true;
  if (partial.agentContext === false) ctx.agentContext = false;

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
  partial: FlagAnswers,
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
  partial: FlagAnswers,
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

async function promptOrUseGit(partial: FlagAnswers, message: () => string): Promise<boolean> {
  if (partial.git !== undefined) {
    if (partial.git) {
      log.info(`${color.green('✓')} Git initialization enabled`);
    }
    return partial.git;
  }

  if (!isGitPrompted(partial, promptModeOf(partial))) return false;

  return promptConfirm(message(), { initialValue: true });
}

async function promptOrUsePackageManager(
  partial: FlagAnswers,
  message: () => string,
): Promise<{ pm?: PackageManager; skipInstall?: boolean }> {
  if (partial.skipInstall) {
    log.info(`${color.green('✓')} Skipping dependency installation`);
    if (partial.pm) {
      log.info(`${color.green('✓')} Using package manager: ${color.bold(partial.pm)}`);
    }
    return { pm: partial.pm, skipInstall: true };
  }

  if (partial.pm !== undefined) {
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

    if (addon.require && !isRequirementMet(addon.require, ctx)) {
      log.warn(`${toolingName} requires ${describeRequire(addon.require, ctx)}. Skipping.`);
      return false;
    }
    return true;
  });

  ctx.project.tooling = filtered;
}

async function promptAllApps(appsFlow: AppsFlow, projectName: string, progress: Progress): Promise<AppContext[]> {
  const apps: AppContext[] = [];
  for (let index = 0; index < appsFlow.count; index++) {
    apps.push(await promptApp(index, appsFlow, progress, projectName));
  }
  return apps;
}

async function promptApp(
  index: number,
  appsFlow: AppsFlow,
  progress: Progress,
  projectName: string,
): Promise<AppContext> {
  const appName = asksAppName(appsFlow.count)
    ? await promptText<string>(
        progress.message(appPromptId(index, 'name'), `Name of app ${color.bold(`#${index + 1}`)}?`),
        {
          defaultValue: `app-${index + 1}`,
          placeholder: `app-${index + 1}`,
          validate: validateAppName,
        },
      )
    : projectName;

  const stackName = (await selectStackPrompt(
    progress.message(appPromptId(index, 'stack'), `Stack for ${color.bold(appName)}`),
  )) as StackName;
  appsFlow.stacks[index] = stackName;

  const metaStack = META.stacks[stackName];

  const libraries = asksLibraries(stackName)
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
