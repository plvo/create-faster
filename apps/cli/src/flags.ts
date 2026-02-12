/** biome-ignore-all lint/style/noNonNullAssertion: <We know the project is defined> */

import { Command } from 'commander';
import color from 'picocolors';
import { META, type ProjectCategoryName } from '@/__meta__';
import { isLibraryCompatible, isRequirementMet } from '@/lib/addon-utils';
import { ASCII } from '@/lib/constants';
import type { AppContext, ProjectContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';

interface ParsedFlags {
  projectName?: string;
  app?: string[];
  database?: string;
  orm?: string;
  linter?: string;
  tooling?: string[];
  git?: boolean;
  pm?: string;
  install?: boolean;
}

export function parseFlags(): Partial<TemplateContext> {
  const program = new Command();

  const ormNames = Object.keys(META.project.orm.options).join(', ');
  const dbNames = Object.keys(META.project.database.options).join(', ');
  const linterNames = Object.keys(META.project.linter.options).join(', ');
  const toolingNames = Object.keys(META.project.tooling.options).join(', ');
  const libraryNames = Object.keys(META.libraries).join(', ');

  program
    .addHelpText('before', ASCII)
    .name(color.blue('npx create-faster'))
    .usage(color.blue('<project-name> [options]'))
    .description(color.cyan('Modern CLI scaffolding tool for production-ready projects'))
    .argument('[project-name]', 'Name of the project to create')
    .optionsGroup(color.bold('Options:'))
    .helpOption('--help', 'Display help for command')
    .option('--app <name:stack:libraries>', 'Add app (repeatable)', collect, [])
    .option('--database <name>', `Database provider (${dbNames})`)
    .option('--orm <name>', `ORM provider (${ormNames})`)
    .option('--linter <name>', `Linter (${linterNames})`)
    .option('--tooling <name>', 'Add tooling (repeatable)', collect, [])
    .option('--git', 'Initialize git repository')
    .option('--no-git', 'Skip git initialization')
    .option('--pm <manager>', 'Package manager (bun, npm, pnpm)')
    .option('--no-install', 'Skip dependency installation')
    .addHelpText(
      'after',
      `
${color.bold('Examples:')}
  ${color.gray('Single app:')}
    $ ${color.blue('npx create-faster myapp')} --app myapp:nextjs:shadcn,tanstack-query
    $ ${color.blue('npx create-faster mysaas')} --app mysaas:nextjs --database postgres --orm drizzle --git

  ${color.gray('Multi apps (turborepo):')}
    $ ${color.blue('npx create-faster myapp')} --app web:nextjs:shadcn --app mobile:expo:nativewind
    $ ${color.blue('npx create-faster mysaas')} --app web:nextjs --app api:hono --database postgres --orm drizzle

  ${color.gray('Available stacks:')} ${Object.keys(META.stacks).join(', ')}
  ${color.gray('Available libraries:')} ${libraryNames}
  ${color.gray('Available ORMs:')} ${ormNames}
  ${color.gray('Available databases:')} ${dbNames}
  ${color.gray('Available linters:')} ${linterNames}
  ${color.gray('Available tooling:')} ${toolingNames}
`,
    )
    .allowUnknownOption(false)
    .showHelpAfterError(color.bold('(use --help for additional information)'));

  program.parse();

  const flags = program.opts<ParsedFlags>();
  const projectName = program.args[0];

  if (Object.keys(flags).length === 0 && !projectName) {
    return {};
  }

  const partial: Partial<TemplateContext> = {};

  if (projectName) {
    partial.projectName = projectName;
  }

  if (flags.app && flags.app.length > 0) {
    partial.apps = flags.app.map((appFlag) => parseAppFlag(appFlag));
  }

  const hasProjectFlags = flags.database || flags.orm || flags.linter || (flags.tooling && flags.tooling.length > 0);
  if (hasProjectFlags) {
    partial.project = { tooling: [] };
  }

  if (flags.database) {
    if (!META.project.database.options[flags.database]) {
      printError(
        `Invalid database '${flags.database}'`,
        `Available databases: ${Object.keys(META.project.database.options).join(', ')}`,
      );
      process.exit(1);
    }
    partial.project!.database = flags.database;
  }

  if (flags.orm) {
    if (!META.project.orm.options[flags.orm]) {
      printError(`Invalid ORM '${flags.orm}'`, `Available ORMs: ${Object.keys(META.project.orm.options).join(', ')}`);
      process.exit(1);
    }
    partial.project!.orm = flags.orm;
  }

  if (flags.linter) {
    if (!META.project.linter.options[flags.linter]) {
      printError(
        `Invalid linter '${flags.linter}'`,
        `Available linters: ${Object.keys(META.project.linter.options).join(', ')}`,
      );
      process.exit(1);
    }
    partial.project!.linter = flags.linter;
  }

  if (flags.tooling && flags.tooling.length > 0) {
    for (const toolingName of flags.tooling) {
      if (!META.project.tooling.options[toolingName]) {
        printError(
          `Invalid tooling '${toolingName}'`,
          `Available tooling: ${Object.keys(META.project.tooling.options).join(', ')}`,
        );
        process.exit(1);
      }
      partial.project!.tooling.push(toolingName);
    }
  }

  if (flags.git !== undefined) {
    partial.git = flags.git;
  }

  if (flags.pm) {
    const validPms = ['bun', 'npm', 'pnpm'];
    if (!validPms.includes(flags.pm)) {
      printError(`Invalid package manager '${flags.pm}'`, `Available: ${validPms.join(', ')}`);
      process.exit(1);
    }
    partial.pm = flags.pm as 'bun' | 'npm' | 'pnpm';
  }

  if (flags.install === false) {
    partial.skipInstall = true;
  }

  validateContext(partial);

  return partial;
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
    appName: appName.trim(),
    stackName: stackName as StackName,
    libraries,
  };
}

function validateContext(partial: Partial<TemplateContext>): void {
  const project = partial.project ?? { tooling: [] };

  if (project.orm && !project.database) {
    printError('ORM requires a database', 'Add --database postgres or --database mysql');
    process.exit(1);
  }

  for (const categoryName of Object.keys(META.project) as ProjectCategoryName[]) {
    const category = META.project[categoryName];
    if (category.selection === 'single') {
      const value = project[categoryName as keyof ProjectContext] as string | undefined;
      if (value) {
        const addon = category.options[value];
        if (addon && !isRequirementMet(addon.require, partial as TemplateContext)) {
          printError(`${categoryName} '${value}' has unmet requirements`, 'Check dependencies and try again');
          process.exit(1);
        }
      }
    } else {
      const values = (project[categoryName as keyof ProjectContext] as string[] | undefined) ?? [];
      for (const value of values) {
        const addon = category.options[value];
        if (addon && !isRequirementMet(addon.require, partial as TemplateContext)) {
          printError(`${categoryName} '${value}' has unmet requirements`, 'Check dependencies and try again');
          process.exit(1);
        }
      }
    }
  }

  if (project.tooling.includes('husky') && !partial.git) {
    printError('Husky requires git', 'Add --git flag');
    process.exit(1);
  }

  if (partial.apps && partial.apps.length > 1) {
    const names = partial.apps.map((app) => app.appName);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      printError('App names must be unique', `Duplicate names found: ${duplicates.join(', ')}`);
      process.exit(1);
    }
  }
}

function printError(title: string, ...messages: string[]): void {
  console.error(`\n${color.red('✖')} ${color.bold(color.red(title))}`);
  for (const msg of messages) {
    console.error(color.gray(msg));
  }
  console.error('');
}
