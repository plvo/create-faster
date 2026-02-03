// ABOUTME: CLI flags parser for non-interactive mode
// ABOUTME: Parses --app and --addon flags into TemplateContext

import { Command } from 'commander';
import color from 'picocolors';
import { META } from '@/__meta__';
import { ASCII } from '@/lib/constants';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { StackName } from '@/types/meta';
import { isAddonCompatible, getAddonsByType, areAddonDependenciesMet } from '@/lib/addon-utils';

interface ParsedFlags {
  projectName?: string;
  app?: string[];
  addon?: string[];
  git?: boolean;
  pm?: string;
  install?: boolean;
}

export function parseFlags(): Partial<TemplateContext> {
  const program = new Command();

  const addonGroups = getAddonsByType(META);
  const ormNames = addonGroups.orm?.join(', ') ?? '';
  const dbNames = addonGroups.database?.join(', ') ?? '';
  const extraNames = addonGroups.extra?.join(', ') ?? '';

  program
    .addHelpText('before', ASCII)
    .name(color.blue('npx create-faster'))
    .usage(color.blue('<project-name> [options]'))
    .description(color.cyan('Modern CLI scaffolding tool for production-ready projects'))
    .argument('[project-name]', 'Name of the project to create')
    .optionsGroup(color.bold('Options:'))
    .helpOption('--help', 'Display help for command')
    .option('--app <name:stack:addons>', 'Add app (repeatable)', collect, [])
    .option('--addon <name>', 'Add global addon (repeatable)', collect, [])
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
    $ ${color.blue('npx create-faster mysaas')} --app mysaas:nextjs --addon drizzle --addon postgres --git

  ${color.gray('Multi apps (turborepo):')}
    $ ${color.blue('npx create-faster myapp')} --app web:nextjs:shadcn --app mobile:expo:nativewind
    $ ${color.blue('npx create-faster mysaas')} --app web:nextjs --app api:hono --addon drizzle --addon postgres

  ${color.gray('Available stacks:')} ${Object.keys(META.stacks).join(', ')}
  ${color.gray('Available ORMs:')} ${ormNames}
  ${color.gray('Available databases:')} ${dbNames}
  ${color.gray('Available extras:')} ${extraNames}
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

  partial.globalAddons = [];
  for (const addonName of flags.addon ?? []) {
    if (!META.addons[addonName]) {
      printError(`Invalid addon '${addonName}'`, `Available addons: ${Object.keys(META.addons).join(', ')}`);
      process.exit(1);
    }
    partial.globalAddons.push(addonName);
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
      'Expected format: name:stack or name:stack:addon1,addon2',
      'Examples:',
      '  --app web:nextjs',
      '  --app web:nextjs:shadcn,mdx',
    );
    process.exit(1);
  }

  const [appName, stackName, addonsStr] = parts as [string, string, string | undefined];

  if (!META.stacks[stackName as StackName]) {
    printError(
      `Invalid stack '${stackName}' for app '${appName}'`,
      `Available stacks: ${Object.keys(META.stacks).join(', ')}`,
    );
    process.exit(1);
  }

  const addons: string[] = addonsStr ? addonsStr.split(',').map((m) => m.trim()) : [];

  for (const addonName of addons) {
    const addon = META.addons[addonName];
    if (!addon) {
      printError(`Invalid addon '${addonName}'`, `Available addons: ${Object.keys(META.addons).join(', ')}`);
      process.exit(1);
    }
    if (addon.type !== 'module') {
      printError(
        `Addon '${addonName}' is not a module`,
        'Use --addon flag for orm, database, and extras',
        `Example: --addon ${addonName}`,
      );
      process.exit(1);
    }
    if (!isAddonCompatible(addon, stackName as StackName)) {
      const compatibleStacks =
        addon.support?.stacks === 'all' ? 'all' : ((addon.support?.stacks as string[])?.join(', ') ?? 'none');
      printError(
        `Addon '${addonName}' is not compatible with stack '${stackName}'`,
        `Compatible stacks: ${compatibleStacks}`,
      );
      process.exit(1);
    }
  }

  return {
    appName: appName.trim(),
    stackName: stackName as StackName,
    addons,
  };
}

function validateContext(partial: Partial<TemplateContext>): void {
  const globalAddons = partial.globalAddons ?? [];

  for (const addonName of globalAddons) {
    const addon = META.addons[addonName];
    if (addon && !areAddonDependenciesMet(addon, globalAddons)) {
      const required = addon.support?.addons?.join(' or ') ?? '';
      printError(
        `Addon '${addonName}' requires one of: ${required}`,
        `Add --addon ${addon.support?.addons?.[0] ?? 'postgres'}`,
      );
      process.exit(1);
    }
  }

  if (globalAddons.includes('husky') && !partial.git) {
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
