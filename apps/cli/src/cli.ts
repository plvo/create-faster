/** biome-ignore-all lint/style/noNonNullAssertion: nope */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, intro, isCancel, outro, select } from '@clack/prompts';
import { META } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/prompts/base-prompts';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { MetaServer, MetaStack } from '@/types/meta';
import { buildServerOptions } from './lib/options';
import { multiselectModulesPrompt, selectStackPrompt } from './prompts/app-prompt';

export async function cli(): Promise<Omit<TemplateContext, 'repo'>> {
  intro('create-faster');

  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    git: false,
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

  ctx.apps = await promptAllApps(Number(appCount), ctx.projectName);
  ctx.database = await promptSelect('database', 'Database?', ctx, { allowNone: true });
  ctx.orm = await promptSelect('orm', 'ORM?', ctx, { allowNone: true });
  ctx.git = await promptConfirm('Do you want to configure Git?', { initialValue: true });
  ctx.extras = await promptMultiselect('extras', 'Extras?', ctx, { required: false });

  outro('Configuration complete!');

  return ctx;
}

async function promptAllApps(count: number, projectName: string): Promise<AppContext[]> {
  if (count <= 1) {
    const app = await promptApp(1, projectName);
    return [app];
  }

  const apps: AppContext[] = [];
  for (let i = 0; i < count; i++) {
    const app = await promptApp(i + 1);
    apps.push(app);
  }
  return apps;
}

async function promptApp(index: number, projectNameIfOneApp?: string): Promise<AppContext> {
  const appName = await promptAppName(index, projectNameIfOneApp);
  const { stackKey, isApp, modules } = await promptStackConfiguration(appName, index);

  const result: AppContext = {
    appName,
    metaApp: undefined,
    metaServer: undefined,
  };

  if (isApp) {
    result.metaApp = { name: stackKey, modules };
    const metaStack = META.app.stacks[stackKey];
    if (metaStack) {
      result.metaServer = await promptServerConfiguration(appName, index, metaStack);
    }
  } else {
    result.metaServer = { name: stackKey, modules };
  }

  return result;
}

async function promptAppName(index: number, projectNameIfOneApp?: string): Promise<string> {
  if (projectNameIfOneApp) {
    return projectNameIfOneApp;
  }

  const appName = await promptText(`App ${index} - Name? (folder name)`, {
    defaultValue: `app-${index}`,
    placeholder: `app-${index}`,
    validate: (value) => {
      const trimedValue = value.trim();
      if (!value || trimedValue === '') return 'App name is required';
    },
  });

  if (isCancel(appName)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return appName!;
}

async function promptStackConfiguration(
  appName: string,
  index: number,
): Promise<{ stackKey: string; isApp: boolean; modules: string[] }> {
  const stackKey = await selectStackPrompt(`Select the stack for app "${appName}":`);
  const isApp = stackKey in META.app.stacks;
  const metaStack = isApp ? META.app.stacks[stackKey] : META.server.stacks[stackKey];

  if (!metaStack) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  const modules = await multiselectModulesPrompt(
    metaStack.modules ?? {},
    `App #${index} - ${appName} - Modules?`,
    false,
  );

  return { stackKey, isApp, modules };
}

async function promptServerConfiguration(
  appName: string,
  index: number,
  metaStack: MetaStack,
): Promise<AppContext['metaServer']> {
  const serverOptions = buildServerOptions(metaStack);

  const serverKey = await select<MetaServer>({
    message: `Do you want to add a server to your app "${appName}"?`,
    options: serverOptions,
  });

  if (isCancel(serverKey)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  if (serverKey === 'none') {
    return undefined;
  }

  const serverFrameworkModules = META.server.stacks[serverKey]?.modules ?? {};
  const serverModules = await multiselectModulesPrompt(
    serverFrameworkModules,
    `App #${index} - ${appName} - Server Modules?`,
    false,
  );

  return { name: serverKey, modules: serverModules };
}
