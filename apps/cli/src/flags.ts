import { Command } from 'commander';
import color from 'picocolors';
import { META } from '@/__meta__';
import { ASCII } from '@/lib/constants';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';

interface ParsedFlags {
  projectName?: string;
  app?: string[];
  database?: string;
  orm?: string;
  git?: boolean;
  pm?: string;
  extras?: string;
}

export function parseFlags(): Partial<TemplateContext> {
  const program = new Command();

  program
    .addHelpText('before', ASCII)
    .name(color.blue('npx create-faster'))
    .usage(color.blue('<project-name> [options]'))
    .description(color.cyan('Modern CLI scaffolding tool for production-ready projects'))
    .argument('[project-name]', 'Name of the project to create')
    .optionsGroup(color.bold('Options:'))
    .helpOption('--help', 'Display help for command')
    .option('--app <name:stack:modules>', 'Add app in format name:stack:module1,module2 (repeatable)', collect, [])
    .option('--database <name>', 'Database provider (postgres, mysql)')
    .option('--orm <name>', 'ORM provider (prisma, drizzle)')
    .option('--git', 'Initialize git repository')
    .option('--pm <manager>', 'Package manager (bun, npm, pnpm)')
    .option('--extras <items>', 'Comma-separated extras (biome, husky)')
    .addHelpText(
      'after',
      `
${color.bold('Examples:')}
  ${color.gray('Single app:')}
    $ ${color.blue('npx create-faster myapp')} --app myapp:nextjs:shadcn,tanstack-query
    $ ${color.blue('npx create-faster mysaas')} --app mysaas:nextjs --database postgres --orm drizzle --git

  ${color.gray('Multi apps (turborepo):')}
    $ ${color.blue('npx create-faster myapp')} --app web:nextjs:shadcn,mdx --app mobile:expo:nativewind
    $ ${color.blue('npx create-faster mysaas')} --app web:nextjs --app api:hono --database postgres --orm drizzle

  ${color.gray('Available stacks:')} ${Object.keys(META.stacks).join(', ')}
  ${color.gray('Available databases:')} ${Object.keys(META.database.stacks).join(', ')}
  ${color.gray('Available ORMs:')} ${Object.keys(META.orm.stacks).join(', ')}
`,
    )
    .allowUnknownOption(false)
    .showHelpAfterError(color.bold('(use --help for additional information)'));

  program.parse();

  const flags = program.opts<ParsedFlags>();
  const projectName = program.args[0];

  // If no flags provided, return empty partial (full interactive mode)
  if (Object.keys(flags).length === 0 && !projectName) {
    return {};
  }

  const partial: Partial<TemplateContext> = {};

  // Project name
  if (projectName) {
    partial.projectName = projectName;
  }

  // Apps configuration
  if (flags.app && flags.app.length > 0) {
    partial.apps = flags.app.map((appFlag) => parseAppFlag(appFlag));
  }

  // Database
  if (flags.database) {
    if (!isValidKey(flags.database, META.database.stacks)) {
      printError(`Invalid database '${flags.database}'`, `Available databases: ${formatOptions(META.database.stacks)}`);
      process.exit(1);
    }
    partial.database = flags.database as keyof typeof META.database.stacks;
  }

  // ORM
  if (flags.orm) {
    if (!isValidKey(flags.orm, META.orm.stacks)) {
      printError(`Invalid ORM '${flags.orm}'`, `Available ORMs: ${formatOptions(META.orm.stacks)}`);
      process.exit(1);
    }
    partial.orm = flags.orm as keyof typeof META.orm.stacks;
  }

  // Git
  if (flags.git) {
    partial.git = true;
  }

  // Package manager
  if (flags.pm) {
    const validPms = ['bun', 'npm', 'pnpm'];
    if (!validPms.includes(flags.pm)) {
      printError(`Invalid package manager '${flags.pm}'`, `Available: ${validPms.join(', ')}`);
      process.exit(1);
    }
    partial.pm = flags.pm as 'bun' | 'npm' | 'pnpm';
  }

  // Extras
  if (flags.extras) {
    const extrasList = flags.extras.split(',').map((e) => e.trim());
    for (const extra of extrasList) {
      if (!isValidKey(extra, META.extras.stacks)) {
        printError(`Invalid extra '${extra}'`, `Available extras: ${formatOptions(META.extras.stacks)}`);
        process.exit(1);
      }
    }
    partial.extras = extrasList as (keyof typeof META.extras.stacks)[];
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
      'Expected format: name:stack or name:stack:module1,module2',
      'Examples:',
      '  --app web:nextjs',
      '  --app web:nextjs:shadcn,mdx',
      '  --app mobile:expo:nativewind',
    );
    process.exit(1);
  }

  const [appName, stackName, modulesStr] = parts as [string, string, string];

  // Validate stack
  if (!isValidKey(stackName, META.stacks)) {
    printError(`Invalid stack '${stackName}' for app '${appName}'`, `Available stacks: ${formatStackOptions()}`);
    process.exit(1);
  }

  const metaStack = META.stacks[stackName as StackName];
  if (!metaStack) {
    printError(`Invalid stack '${stackName}' for app '${appName}'`, `Available stacks: ${formatStackOptions()}`);
    process.exit(1);
  }
  const modules: string[] = modulesStr ? modulesStr.split(',').map((m) => m.trim()) : [];

  // Validate modules
  if (modules.length > 0 && metaStack.modules) {
    const availableModules = getAllModuleKeys(metaStack.modules);
    for (const module of modules) {
      if (!availableModules.includes(module)) {
        printError(
          `Invalid module '${module}' for stack '${stackName}'`,
          `Available modules for ${metaStack.label}:`,
          formatModuleOptions(metaStack.modules),
        );
        process.exit(1);
      }
    }
  } else if (modules.length > 0 && !metaStack.modules) {
    printError(`Stack '${stackName}' does not support modules`, `You provided: ${modules.join(', ')}`);
    process.exit(1);
  }

  return {
    appName: appName.trim(),
    stackName: stackName as StackName,
    modules,
  };
}

function validateContext(partial: Partial<TemplateContext>): void {
  // ORM requires database
  if (partial.orm && !partial.database) {
    printError(
      'ORM requires a database',
      'Add --database postgres or --database mysql',
      `You selected: --orm ${partial.orm}`,
    );
    process.exit(1);
  }

  // Husky requires git
  if (partial.extras?.includes('husky') && !partial.git) {
    printError('Husky requires git to be initialized', 'Add --git flag', 'You selected: --extras husky');
    process.exit(1);
  }

  // Validate app names are unique
  if (partial.apps && partial.apps.length > 1) {
    const names = partial.apps.map((app) => app.appName);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length > 0) {
      printError('App names must be unique', `Duplicate names found: ${duplicates.join(', ')}`);
      process.exit(1);
    }
  }
}

// Helper functions
function isValidKey<T extends Record<string, unknown>>(key: string, obj: T): boolean {
  return key in obj;
}

function formatOptions<T extends Record<string, { label: string; hint?: string }>>(stacks: T): string {
  return Object.entries(stacks)
    .map(([key, meta]) => `${key} (${meta.hint || meta.label})`)
    .join(', ');
}

function formatStackOptions(): string {
  return Object.entries(META.stacks)
    .map(([key, meta]) => `${key} [${meta.type}] (${meta.hint})`)
    .join(', ');
}

function formatModuleOptions(modules: Record<string, Record<string, { label: string; hint?: string }>>): string {
  return Object.entries(modules)
    .map(([category, mods]) => {
      const modList = Object.entries(mods)
        .map(([key, mod]) => `${key} (${mod.hint || mod.label})`)
        .join(', ');
      return `  ${category}: ${modList}`;
    })
    .join('\n');
}

function getAllModuleKeys(modules: Record<string, Record<string, { label: string; hint?: string }>>): string[] {
  return Object.values(modules).flatMap((category) => Object.keys(category));
}

function printError(title: string, ...messages: string[]): void {
  console.error(`\n${color.red('')} ${color.bold(color.red(title))}`);
  for (const msg of messages) {
    console.error(color.gray(msg));
  }
  console.error('');
}
