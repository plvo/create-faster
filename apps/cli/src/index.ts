/** biome-ignore-all lint/style/noNonNullAssertion: nope */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, intro, isCancel, multiselect, type Option, outro, select } from '@clack/prompts';
import { META, MODULES } from '@/__meta__';
import { displayGenerationResults, generateProjectFiles } from '@/lib/file-generator';
import { runPostGeneration } from '@/lib/post-generation';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/lib/prompts';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { AppContext, TemplateContext } from '@/types';

type MetaApp = keyof typeof META.app.stacks;
type MetaServer = keyof typeof META.server.stacks | 'builtin';

async function processAppWithServer(index: number, appName: string): Promise<AppContext> {
  const stacks = META.app.stacks;

  const options: Option<MetaApp>[] = Object.entries(stacks).map(([value, meta]) => ({
    value: value as MetaApp,
    label: meta.label,
    hint: meta.hint,
  }));

  const appName_ = await select<MetaApp>({
    message: `App ${index} - Framework?`,
    options,
  });

  if (isCancel(appName_)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const moduleOptions = Object.entries(MODULES[appName_] ?? {}).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  let modules: string[] = [];
  if (moduleOptions.length > 0) {
    const result = await multiselect({
      message: `App ${index} - Modules?`,
      options: moduleOptions,
      required: false,
    });

    if (isCancel(result)) {
      cancel('Operation cancelled');
      process.exit(0);
    }

    modules = (result as string[]) || [];
  }

  return await processServer(index, appName, appName_, modules);
}

async function processServer(
  index: number,
  appName: string,
  metaAppName?: MetaApp,
  appModules?: string[],
): Promise<AppContext> {
  const serverOptions = Object.entries(META.server.stacks).map(([value, meta]) => ({
    value: value as MetaServer,
    label: meta.label,
    hint: meta.hint,
  }));

  const appMeta = metaAppName ? META.app.stacks[metaAppName] : undefined;

  if (appMeta?.hasBackend) {
    serverOptions.unshift({
      value: 'builtin' as MetaServer,
      label: `Use ${appMeta.label} built-in`,
      hint: 'API routes, server actions',
    });
  }

  const serverName = await select<MetaServer>({
    message: `App ${index} - Server?`,
    options: serverOptions,
  });

  if (isCancel(serverName)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const result: AppContext = {
    appName,
    metaApp: metaAppName ? { name: metaAppName, modules: appModules || [] } : undefined,
    metaServer: { name: serverName, modules: [] },
  };

  if (serverName === 'builtin') {
    return result;
  }

  // Prompt for server modules
  const serverModuleOptions = Object.entries(MODULES[serverName] ?? {}).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  let serverModules: string[] = [];

  if (serverModuleOptions.length > 0) {
    const modulesResult = await multiselect({
      message: `App ${index} - Server Modules?`,
      options: serverModuleOptions,
      required: false,
    });

    if (isCancel(modulesResult)) {
      cancel('Operation cancelled');
      process.exit(0);
    }

    serverModules = (modulesResult as string[]) || [];
  }

  result.metaServer!.modules = serverModules;
  return result;
}

async function promptApp(index: number, projectNameIfOneApp?: string): Promise<AppContext> {
  const appName =
    projectNameIfOneApp ??
    (await promptText(`App ${index} - Name? (folder name)`, {
      defaultValue: `app-${index}`,
      placeholder: `app-${index}`,
      validate: (value) => {
        const trimedValue = value.trim();
        if (!value || trimedValue === '') return 'App name is required';
        const fullPath = join(process.cwd(), trimedValue);
        try {
          if (existsSync(fullPath)) {
            return `A file or directory named "${trimedValue}" already exists. Please choose a different name.`;
          }
        } catch (e) {
          return `An error occurred while checking if the app name is valid: ${(e as Error).message}`;
        }
      },
    }));

  const platform = await select({
    message: `Select the platform type for app "${appName}":`,
    options: [
      { value: 'app', label: 'Web / Mobile App', hint: 'Next.js, React Native, Astro...' },
      { value: 'server', label: 'Server / API', hint: 'Hono, Express...' },
    ],
  });

  if (isCancel(platform)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  if (platform === 'app') {
    return await processAppWithServer(index, appName!);
  }

  return await processServer(index, appName!);
}

async function cli(): Promise<Omit<TemplateContext, 'repo'>> {
  intro('create-faster');
  const ctx: Omit<TemplateContext, 'repo'> = {
    apps: [],
    git: false,
    projectName: '',
  };

  const projectName = await promptText('Project name?', {
    placeholder: 'my-app',
    initialValue: 'my-app',
    validate: (value) => {
      if (!value || value.trim() === '') return 'Project name is required';
    },
  });

  ctx.projectName = projectName!;

  const appCount = await promptText<number>('How many apps? Turborepo will be used if you have more than one app', {
    initialValue: '1',
    placeholder: '1',
    validate: (value) => {
      const num = Number(value);
      if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
    },
  });

  for (let i = 0; i < Number(appCount); i++) {
    const app = await promptApp(i + 1, i === 0 ? ctx.projectName : undefined);
    ctx.apps.push(app);
  }

  const database = await promptSelect('database', 'Database?', ctx, { allowNone: true });
  ctx.database = database;

  const orm = await promptSelect('orm', 'ORM?', ctx, { allowNone: true });
  ctx.orm = orm;

  const git = await promptConfirm('Do you want to configure Git?', { initialValue: true });
  ctx.git = git;

  const extras = await promptMultiselect('extras', 'Extras?', ctx, { required: false });
  ctx.extras = extras;

  outro('Configuration complete!');

  return ctx;
}

async function main() {
  try {
    const config = await cli();

    const ctx: TemplateContext = {
      repo: config.apps.length > 1 ? 'turborepo' : 'single',
      ...config,
    };

    // Get all templates to generate
    const templates = getAllTemplatesForContext(ctx);

    // Generate project files
    const result = await generateProjectFiles(templates, ctx);

    // Display results
    displayGenerationResults(result);

    // Exit if generation failed
    if (!result.success) {
      console.error('\n✗ Project generation failed. Please fix the errors and try again.');
      process.exit(1);
    }

    // Run post-generation tasks (install deps, git init)
    const projectPath = join(process.cwd(), ctx.projectName);
    await runPostGeneration(ctx, projectPath, {
      install: true,
      packageManager: 'bun',
    });
  } catch (error) {
    console.error('\n✗ An error occurred:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);
