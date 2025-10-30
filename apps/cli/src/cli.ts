/** biome-ignore-all lint/style/noNonNullAssertion: nope */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, groupMultiselect, intro, isCancel, type Option, outro, select } from '@clack/prompts';
import { META, MODULES } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/lib/prompts';
import type { AppContext, MetaApp, MetaServer, TemplateContext } from '@/types';

export async function cli(): Promise<Omit<TemplateContext, 'repo'>> {
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
      const trimedValue = value.trim();
      if (!value || trimedValue === '') return 'Project name is required';
      const fullPath = join(process.cwd(), trimedValue);
      try {
        if (existsSync(fullPath)) {
          return `A file or directory named "${trimedValue}" already exists. Please choose a different name.`;
        }
      } catch (e) {
        return `An error occurred while checking if the app name is valid: ${(e as Error).message}`;
      }
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

  if (Number(appCount) === 1) {
    const app = await promptApp(0, ctx.projectName);
    ctx.apps.push(app);
  } else {
    for (let i = 0; i < Number(appCount); i++) {
      const app = await promptApp(i + 1);
      ctx.apps.push(app);
    }
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

async function processAppWithServer(index: number, appName: string): Promise<AppContext> {
  const stacks = META.app.stacks;

  const options: Option<MetaApp>[] = Object.entries(stacks).map(([value, meta]) => ({
    value: value as MetaApp,
    label: meta.label,
    hint: meta.hint,
  }));

  const framework = await select<MetaApp>({
    message: `App #${index} - ${appName} - Framework?`,
    options,
  });

  if (isCancel(framework)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  // Build grouped options from nested MODULES structure
  const frameworkModules = MODULES[framework] ?? {};
  const groupedModules: Record<string, Option<string>[]> = {};

  for (const [category, categoryModules] of Object.entries(frameworkModules)) {
    groupedModules[category] = Object.entries(categoryModules).map(([moduleName, meta]) => ({
      value: moduleName,
      label: meta.label,
      hint: meta.hint,
    }));
  }

  let modules: string[] = [];
  if (Object.keys(groupedModules).length > 0) {
    const result = await groupMultiselect({
      message: `App #${index} - ${appName} - Modules?`,
      options: groupedModules,
      required: false,
      selectableGroups: true,
    });

    if (isCancel(result)) {
      cancel('Operation cancelled');
      process.exit(0);
    }

    modules = (result as string[]) || [];
  }

  return await processServer(index, appName, framework, modules);
}

async function processServer(
  index: number,
  appName: string,
  appFramework?: MetaApp,
  appModules?: string[],
): Promise<AppContext> {
  const serverOptions = Object.entries(META.server.stacks).map(([value, meta]) => ({
    value: value as MetaServer,
    label: meta.label,
    hint: meta.hint,
  }));

  const appMeta = appFramework ? META.app.stacks[appFramework] : undefined;

  if (appMeta) {
    if (appMeta.hasBackend) {
      serverOptions.unshift({
        value: 'none',
        label: `Use ${appMeta.label} built-in`,
        hint: 'API routes, server actions',
      });
    } else {
      serverOptions.push({
        value: 'none',
        label: 'None',
        hint: 'No server',
      });
    }
  }

  const serverName = await select<MetaServer>({
    message: `App #${index} - ${appName} - Server?`,
    options: serverOptions,
  });

  if (isCancel(serverName)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const result: AppContext = {
    appName,
    metaApp: appFramework ? { name: appFramework, modules: appModules || [] } : undefined,
    metaServer: { name: serverName, modules: [] },
  };

  if (serverName === 'none') {
    return result;
  }

  const serverFrameworkModules = MODULES[serverName] ?? {};
  const groupedServerModules: Record<string, Option<string>[]> = {};

  for (const [category, categoryModules] of Object.entries(serverFrameworkModules)) {
    groupedServerModules[category] = Object.entries(categoryModules).map(([moduleName, meta]) => ({
      value: moduleName,
      label: meta.label,
      hint: meta.hint,
    }));
  }

  let serverModules: string[] = [];

  if (Object.keys(groupedServerModules).length > 0) {
    const modulesResult = await groupMultiselect({
      message: `App ${index} - Server Modules?`,
      options: groupedServerModules,
      required: false,
      selectableGroups: true,
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
