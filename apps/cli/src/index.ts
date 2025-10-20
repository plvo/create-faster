import * as p from '@clack/prompts';
import { program } from 'commander';
import { META } from '@/__meta__';
import { mergeOptions, validateOptions } from '@/lib/options';
import type { Config } from '@/lib/schema';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { Category, TemplateContext } from '@/types';

interface RawFlags {
  name?: string;
  framework?: string;
  frameworkApp?: string;
  backend?: string;
  backendApp?: string;
  orm?: string;
  database?: string;
  extras?: string[];
}

function parseFlags(): Partial<Config> {
  program
    .name('create-faster')
    .description('A quick way to create a new project')
    .option('--name <string>', 'Project name')
    .option('--framework <type>', 'Framework (nextjs)')
    .option('--framework-app <name>', 'Framework app name', 'web')
    .option('--backend <type>', 'Backend (hono)')
    .option('--backend-app <name>', 'Backend app name', 'api')
    .option('--orm <type>', 'ORM (prisma|drizzle)')
    .option('--database <type>', 'Database (postgres)')
    .option('--extras <items...>', 'Extras (biome, git, husky)')
    .parse();

  const raw = program.opts<RawFlags>();

  // Transform raw flags to Config format
  return {
    name: raw.name,
    framework: raw.framework ? { stack: raw.framework, appName: raw.frameworkApp || 'web' } : undefined,
    backend: raw.backend ? { stack: raw.backend, appName: raw.backendApp || 'api' } : undefined,
    orm: raw.orm,
    database: raw.database,
    extras: raw.extras,
  };
}

function hasAnyFlags(flags: Partial<Config>): boolean {
  return Object.keys(flags).length > 0;
}

async function cli(partial: Partial<Config> = {}): Promise<Config> {
  p.intro('create-faster');

  const name = await promptText('Project name?', partial.name, {
    placeholder: 'my-app',
    defaultValue: 'my-app',
    validate: (value) => {
      if (!value) return 'Project name is required';
    },
  });

  // Framework
  const frameworkStack = await promptSelect('framework', 'Framework?', partial.framework?.stack, { allowNone: true });
  const frameworkAppName = frameworkStack
    ? await promptText(`Framework app name?`, partial.framework?.appName, {
        defaultValue: 'web',
      })
    : undefined;

  const framework =
    frameworkStack && frameworkAppName
      ? {
          stack: frameworkStack,
          appName: frameworkAppName,
        }
      : undefined;

  // Backend
  const backendStack = await promptSelect('backend', 'Backend?', partial.backend?.stack, { allowNone: true });
  const backendAppName = backendStack
    ? await promptText(`Backend app name?`, partial.backend?.appName, {
        defaultValue: 'api',
      })
    : undefined;

  const backend =
    backendStack && backendAppName
      ? {
          stack: backendStack,
          appName: backendAppName,
        }
      : undefined;

  const orm = await promptSelect('orm', 'ORM?', partial.orm, { allowNone: true });
  const database = await promptSelect('database', 'Database?', partial.database, {
    allowNone: true,
    skip: !orm,
  });
  const extras = await promptMultiselect('extras', 'Select extras:', partial.extras);

  p.outro('Configuration complete!');

  return {
    name,
    framework,
    backend,
    orm,
    database,
    extras,
  };
}

async function promptText(
  message: string,
  partial?: string,
  options?: Partial<p.TextOptions>,
): Promise<string | undefined> {
  if (partial) return partial;

  const result = await p.text({
    message,
    ...options,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function promptSelect<C extends Category>(
  category: C,
  message: string,
  partial?: string,
  options?: { allowNone?: boolean; skip?: boolean },
): Promise<string | undefined> {
  if (partial) return partial;
  if (options?.skip) return undefined;

  const selectOptions: p.Option<string | undefined>[] = Object.entries(META[category].stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  if (options?.allowNone) {
    selectOptions.push({ value: undefined, label: 'None', hint: undefined });
  }

  const result = await p.select({ message, options: selectOptions });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function promptMultiselect<C extends Category>(
  category: C,
  message: string,
  partial?: string[],
): Promise<string[] | undefined> {
  if (partial) return partial;

  const selectOptions = Object.entries(META[category].stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  const result = await p.multiselect({ message, options: selectOptions, required: false });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function main() {
  const flags = parseFlags();

  const config: Config = hasAnyFlags(flags) ? mergeOptions(validateOptions(flags), await cli(flags)) : await cli();

  const ctx: TemplateContext = {
    repo: config.framework && config.backend ? 'turborepo' : 'single',
    ...config,
  };

  const templates = getAllTemplatesForContext(ctx);

  console.log('\nTemplates to generate:');
  console.log(templates);
}

main().catch(console.error);
