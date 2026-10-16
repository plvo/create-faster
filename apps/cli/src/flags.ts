import { Command } from 'commander';
import color from 'picocolors';
import { META } from '@/__meta__';
import {
  describeRequire,
  isLibraryCompatible,
  isLocalFilesystemSatisfied,
  isRequirementMet,
  isServerRuntimeSatisfied,
  isSingletonDbSatisfied,
} from '@/lib/addon-utils';
import { ASCII, CLI_VERSION, PACKAGE_MANAGERS } from '@/lib/constants';
import { missingPackageManagerMessage, readPackageManagerVersion } from '@/lib/package-manager';
import { projectNameOf, validateAppName, validateProjectName } from '@/lib/project-location';
import { isInteractiveTerminal, missingAnswersWithoutTerminal, promptModeOf } from '@/lib/project-prompts';
import { printError } from '@/tui/print-error';
import type { AppContext, FlagAnswers, ProjectContext, TemplateContext } from '@/types/ctx';
import type { ProjectCategoryName } from '@/types/meta';
import type { StackName } from '@/types/stack-name';

interface ParsedFlags {
  projectName?: string;
  app?: string[];
  blueprint?: string;
  database?: string;
  orm?: string;
  deployment?: string;
  linter?: string;
  tooling?: string[];
  git?: boolean;
  pm?: string;
  install?: boolean;
  agentContext?: boolean;
  yes?: boolean;
}

const NO_SELECTION = 'none';

function namesWithNoSelection(categoryName: ProjectCategoryName): string {
  return [...Object.keys(META.project[categoryName].options), NO_SELECTION].join(', ');
}

function validateOption(label: string, value: string, options: Record<string, unknown>, plural?: string): void {
  if (!options[value]) {
    printError(`Invalid ${label} '${value}'`, `Available ${plural ?? `${label}s`}: ${Object.keys(options).join(', ')}`);
    process.exit(1);
  }
}

function applyProjectFlags(flags: ParsedFlags, project: ProjectContext, noSelection: ProjectCategoryName[]): void {
  for (const categoryName of Object.keys(META.project) as ProjectCategoryName[]) {
    const values = [flags[categoryName] ?? []].flat();
    if (values.length === 0) continue;

    if (values.includes(NO_SELECTION)) {
      if (values.length > 1) {
        printError(`--${categoryName} ${NO_SELECTION} cannot be combined with another value`);
        process.exit(1);
      }
      noSelection.push(categoryName);
      continue;
    }

    const category = META.project[categoryName];
    for (const value of values) {
      validateOption(categoryName, value, category.options);
    }
    Object.assign(project, { [categoryName]: category.selection === 'single' ? values[0] : values });
  }
}

export function parseFlags(): FlagAnswers {
  const program = new Command();

  const ormNames = namesWithNoSelection('orm');
  const dbNames = namesWithNoSelection('database');
  const deploymentNames = namesWithNoSelection('deployment');
  const linterNames = namesWithNoSelection('linter');
  const toolingNames = namesWithNoSelection('tooling');
  const libraryNames = Object.keys(META.libraries).join(', ');
  const [exampleBlueprint = '<name>'] = Object.keys(META.blueprints);

  program
    .addHelpText('before', ASCII)
    .name(color.blue('npx create-faster'))
    .usage(color.blue('<project-name> [options]'))
    .description(color.cyan('Modern CLI scaffolding tool for production-ready projects'))
    .argument('[project-name]', 'Name of the project to create')
    .optionsGroup(color.bold('Options:'))
    .helpOption('--help', 'Display help for command')
    .version(CLI_VERSION, '-V, --version', 'Display the version')
    .option('--app <name:stack:libraries>', 'Add app (repeatable)', collect, [])
    .option(
      '--blueprint <name>',
      `Use a blueprint template (${Object.keys(META.blueprints).join(', ') || 'none available'})`,
    )
    .option('--database <name>', `Database provider (${dbNames})`)
    .option('--orm <name>', `ORM provider (${ormNames})`)
    .option('--deployment <name>', `Deployment platform (${deploymentNames})`)
    .option('--linter <name>', `Linter (${linterNames})`)
    .option('--tooling <name>', `Add tooling (repeatable) (${toolingNames})`, collect, [])
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--pm <manager>', `Package manager (${PACKAGE_MANAGERS.join(', ')})`)
    .option('--no-install', 'Skip dependency installation')
    .option('--no-agent-context', 'Skip AGENTS.md / CLAUDE.md generation')
    .option('--yes', 'Skip every prompt no flag answers (project choices stay empty, no git, no install)')
    .addHelpText(
      'after',
      `
${color.bold('Prompts:')}
  In an interactive terminal, every database, ORM, deployment, linter, tooling, git and package
  manager choice that no flag answers is prompted. Pass 'none' to a category flag to leave it empty,
  or --yes to skip every such prompt. Without a terminal (CI, scripts) nothing is prompted: project
  choices stay empty, there is no git and no install unless a flag says otherwise.

${color.bold('Examples:')}
  ${color.gray('Single app:')}
    $ ${color.blue('npx create-faster myapp')} --app myapp:nextjs:shadcn,tanstack-query
    $ ${color.blue('npx create-faster mysaas')} --app mysaas:nextjs --database postgres --orm drizzle --git

  ${color.gray('Multi apps (turborepo):')}
    $ ${color.blue('npx create-faster myapp')} --app web:nextjs:shadcn --app mobile:expo:nativewind
    $ ${color.blue('npx create-faster mysaas')} --app web:nextjs --app api:hono --database postgres --orm drizzle

  ${color.gray('Blueprint:')}
    $ ${color.blue('npx create-faster myapp')} --blueprint ${exampleBlueprint}

  ${color.gray('Available stacks:')} ${Object.keys(META.stacks).join(', ')}
  ${color.gray('Available libraries:')} ${libraryNames}
  ${color.gray('Available ORMs:')} ${ormNames}
  ${color.gray('Available databases:')} ${dbNames}
  ${color.gray('Available deployments:')} ${deploymentNames}
  ${color.gray('Available linters:')} ${linterNames}
  ${color.gray('Available tooling:')} ${toolingNames}
`,
    )
    .allowUnknownOption(false)
    .showHelpAfterError(color.bold('(use --help for additional information)'));

  program.parse();

  const flags = program.opts<ParsedFlags>();
  const projectDir = program.args[0];

  if (Object.keys(flags).length === 0 && !projectDir) {
    exitWhenAnswersMissing({});
    return {};
  }

  const partial: FlagAnswers = {};

  if (projectDir) {
    const projectName = projectNameOf(projectDir);
    const nameError = validateProjectName(projectName);
    if (nameError) {
      printError('Invalid project name', nameError);
      process.exit(1);
    }
    partial.projectDir = projectDir;
  }

  if (flags.app && flags.app.length > 0) {
    partial.apps = flags.app.map((appFlag) => parseAppFlag(appFlag));
  }

  if (flags.blueprint) {
    const blueprint = META.blueprints[flags.blueprint];
    if (!blueprint) {
      printError(
        `Invalid blueprint '${flags.blueprint}'`,
        `Available blueprints: ${Object.keys(META.blueprints).join(', ') || 'none'}`,
      );
      process.exit(1);
    }

    const conflicting = ['app', 'database', 'orm'].filter((f) => {
      const val = flags[f as keyof ParsedFlags];
      return val !== undefined && (!Array.isArray(val) || val.length > 0);
    });
    if (conflicting.length > 0) {
      printError(
        `--blueprint cannot be combined with --${conflicting[0]}`,
        'Blueprint defines apps, database, and ORM',
      );
      process.exit(1);
    }

    partial.blueprint = flags.blueprint;
    partial.apps = blueprint.context.apps.map((app) => ({ ...app }));
    partial.project = { ...blueprint.context.project, tooling: [] } as ProjectContext;
  }

  const noSelection: ProjectCategoryName[] = [];
  const hasProjectFlags = (Object.keys(META.project) as ProjectCategoryName[]).some((name) => flags[name]?.length);
  if (!partial.project && hasProjectFlags) {
    partial.project = { tooling: [] };
  }
  if (partial.project) {
    applyProjectFlags(flags, partial.project, noSelection);
  }
  if (noSelection.length > 0) {
    partial.noSelection = noSelection;
  }

  if (flags.yes) {
    partial.skipPrompts = true;
  }

  if (flags.git !== undefined) {
    partial.git = flags.git;
  }

  if (flags.pm) {
    const pm = PACKAGE_MANAGERS.find((name) => name === flags.pm);
    if (!pm) {
      printError(`Invalid package manager '${flags.pm}'`, `Available: ${PACKAGE_MANAGERS.join(', ')}`);
      process.exit(1);
    }
    if (!readPackageManagerVersion(pm)) {
      printError(missingPackageManagerMessage(pm));
      process.exit(1);
    }
    partial.pm = pm;
  }

  if (flags.install === false) {
    partial.skipInstall = true;
  }

  if (flags.agentContext === false) {
    partial.agentContext = false;
  }

  validateAppNames(partial);
  exitWhenAnswersMissing(partial);
  if (!isInteractiveTerminal()) {
    validateRequirements(partial, partial);
  }

  return partial;
}

function exitWhenAnswersMissing(partial: FlagAnswers): void {
  const missingAnswers = missingAnswersWithoutTerminal(partial, promptModeOf(partial));
  if (missingAnswers.length === 0) return;

  for (const { title, hint } of missingAnswers) printError(title, hint);
  process.exit(1);
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseAppFlag(appFlag: string): AppContext {
  const parts = appFlag.split(':');

  if (parts.length < 2 || parts.length > 3) {
    printError(
      `Invalid app format '${appFlag}'`,
      'Expected format: name:stack or name:stack:library1,library2',
      'Examples:',
      '  --app web:nextjs',
      '  --app web:nextjs:shadcn,mdx',
    );
    process.exit(1);
  }

  const [appName, stackName, librariesStr] = parts as [string, string, string | undefined];

  const appNameError = validateAppName(appName);
  if (appNameError) {
    printError('Invalid app name', appNameError);
    process.exit(1);
  }

  if (!META.stacks[stackName as StackName]) {
    printError(
      `Invalid stack '${stackName}' for app '${appName}'`,
      `Available stacks: ${Object.keys(META.stacks).join(', ')}`,
    );
    process.exit(1);
  }

  const libraries: string[] = librariesStr ? librariesStr.split(',').map((m) => m.trim()) : [];

  for (const libraryName of libraries) {
    const library = META.libraries[libraryName];
    if (!library) {
      printError(`Invalid library '${libraryName}'`, `Available libraries: ${Object.keys(META.libraries).join(', ')}`);
      process.exit(1);
    }
    if (!isLibraryCompatible(library, stackName as StackName)) {
      const compatibleStacks =
        library.support?.stacks === 'all' ? 'all' : ((library.support?.stacks as string[])?.join(', ') ?? 'none');
      printError(
        `Library '${libraryName}' is not compatible with stack '${stackName}'`,
        `Compatible stacks: ${compatibleStacks}`,
      );
      process.exit(1);
    }
  }

  return {
    appName,
    stackName: stackName as StackName,
    libraries,
  };
}

export function validateRequirements(selection: Partial<TemplateContext>, ctx: Partial<TemplateContext>): void {
  const project = selection.project ?? { tooling: [] };

  if (project.orm && !ctx.project?.database) {
    printError(
      'ORM requires a database',
      `Add --database <name> (${Object.keys(META.project.database.options).join(', ')})`,
    );
    process.exit(1);
  }

  for (const app of selection.apps ?? []) {
    for (const libraryName of app.libraries) {
      const library = META.libraries[libraryName];
      if (library?.require && !isRequirementMet(library.require, ctx)) {
        printError(`library '${libraryName}' on app '${app.appName}' requires ${describeRequire(library.require)}`);
        process.exit(1);
      }
    }
  }

  for (const categoryName of Object.keys(META.project) as ProjectCategoryName[]) {
    const category = META.project[categoryName];
    const selected = project[categoryName as keyof ProjectContext];
    const values =
      category.selection === 'single' ? (selected ? [selected as string] : []) : ((selected as string[]) ?? []);
    for (const value of values) {
      const addon = category.options[value];
      if (addon?.require && !isRequirementMet(addon.require, ctx)) {
        printError(`${categoryName} '${value}' requires ${describeRequire(addon.require)}`);
        process.exit(1);
      }
      if (!isServerRuntimeSatisfied(addon, ctx)) {
        const blocking = (ctx.apps ?? [])
          .flatMap((app) => app.libraries)
          .find((lib) => META.libraries[lib]?.needsServerRuntime);
        if (blocking) {
          printError(
            `${categoryName} '${value}' is incompatible with library '${blocking}'`,
            `'${blocking}' needs a server runtime, which '${value}' does not provide`,
          );
        } else {
          printError(`${categoryName} '${value}' needs a server runtime`);
        }
        process.exit(1);
      }
      if (!isSingletonDbSatisfied(addon, ctx)) {
        const blocking = (ctx.apps ?? [])
          .flatMap((app) => app.libraries)
          .find((lib) => META.libraries[lib]?.needsSingletonDb);
        printError(
          `${categoryName} '${value}' is not yet supported with library '${blocking}' on this deployment`,
          `'${blocking}' uses a module-singleton database; '${value}' is a per-request Cloudflare binding (see #153)`,
        );
        process.exit(1);
      }
      if (!isLocalFilesystemSatisfied(addon, ctx)) {
        const deployment = ctx.project?.deployment;
        printError(
          `${categoryName} '${value}' is incompatible with deployment '${deployment}'`,
          `'${value}' needs a local filesystem, which '${deployment}' does not provide`,
        );
        process.exit(1);
      }
    }
  }
}

function validateAppNames(partial: Partial<TemplateContext>): void {
  if (partial.apps && partial.apps.length > 1) {
    const names = partial.apps.map((app) => app.appName);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      printError('App names must be unique', `Duplicate names found: ${duplicates.join(', ')}`);
      process.exit(1);
    }
  }
}
