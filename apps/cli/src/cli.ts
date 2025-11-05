import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cancel, isCancel, select } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/prompts/base-prompts';
import { multiselectModulesPrompt, selectStackPrompt } from '@/prompts/stack-prompts';
import type { AppContext, TemplateContext } from '@/types/ctx';
import type { MetaServer, MetaStack } from '@/types/meta';

export async function cli(): Promise<Omit<TemplateContext, 'repo'>> {
  const ctx: Omit<TemplateContext, 'repo'> = {
    projectName: '',
    apps: [],
    git: false,
  };

  ctx.projectName = (await promptText('Name of your project?', {
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
  })) as string;

  const appCount = await promptText<number>(
    `How many apps do you want to create? ${color.gray('(Turborepo if more than one)')}`,
    {
      initialValue: '1',
      placeholder: '1',
      validate: (value) => {
        const num = Number(value);
        if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
      },
    },
  );

  ctx.apps = await promptAllApps(Number(appCount), ctx.projectName);
  ctx.database = await promptSelect('database', 'Include a database?', ctx, { allowNone: true });
  ctx.orm = await promptSelect('orm', 'Configure an ORM?', ctx, { allowNone: true });
  ctx.extras = await promptMultiselect('extras', 'Add any extras?', ctx, { required: false });
  ctx.git = await promptConfirm('Initialize Git?', { initialValue: true });
  ctx.pm = await promptSelect(undefined, 'Install dependencies now?', ctx, {
    options: [
      { label: 'Install with bun', value: 'bun' },
      { label: 'Install with pnpm', value: 'pnpm' },
      { label: 'Install with npm', value: 'npm' },
      { label: 'Skip installation', value: undefined },
    ],
  });

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
  const { stackKey, isApp, modules } = await promptStackConfiguration(appName);

  const result: AppContext = {
    appName,
    metaApp: undefined,
    metaServer: undefined,
  };

  if (isApp) {
    result.metaApp = { name: stackKey, modules };
    const metaStack = META.app.stacks[stackKey];
    if (metaStack) {
      result.metaServer = await promptServerConfiguration(appName, metaStack);
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

  const appName = await promptText(`Name of the app #${index}? (folder name)`, {
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
    `Do you want to add any modules to "${appName}"?`,
    false,
  );

  return { stackKey, isApp, modules };
}

async function promptServerConfiguration(appName: string, metaStack: MetaStack): Promise<AppContext['metaServer']> {
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
    `Do you want to add any server modules to "${appName}"?`,
    false,
  );

  return { name: serverKey, modules: serverModules };
}

function buildServerOptions(metaStack: MetaStack) {
  const serverOptions = Object.entries(META.server.stacks).map(([key, meta]) => ({
    value: key,
    label: meta.label,
    hint: meta.hint,
  }));

  if (metaStack.hasBackend) {
    serverOptions.unshift({
      value: 'none',
      label: `Use ${metaStack.label} built-in`,
      hint: 'API routes, server actions',
    });
  } else {
    serverOptions.push({
      value: 'none',
      label: 'None',
      hint: 'No server',
    });
  }

  return serverOptions;
}
