/** biome-ignore-all lint/style/noNonNullAssertion: nope */

import { cancel, intro, isCancel, type Option, outro, select } from '@clack/prompts';
import { META } from '@/__meta__';
import { promptConfirm, promptMultiselect, promptSelect, promptText } from '@/lib/prompts';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { App, Backend, Framework, Platform, TemplateContext } from '@/types';

async function promptPlatform(message: string): Promise<Platform> {
  const result = await select({
    message,
    options: [
      { value: 'web', label: 'Web', hint: 'Next.js, Astro...' },
      { value: 'api', label: 'API/Server', hint: 'Hono, Express...' },
      { value: 'mobile', label: 'Mobile', hint: 'Expo, React Native' },
    ],
  });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function promptFrameworkForPlatform(platform: Platform, message: string): Promise<Framework> {
  const stacks = META[platform].stacks;

  const options = Object.entries(stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  const result = await select({ message, options });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function promptBackendForApp(
  appName: string,
  platform: Platform,
  framework: Framework,
): Promise<Backend | undefined> {
  const frameworkMeta = META[platform].stacks[framework];

  const options: Option<Backend | undefined>[] = [];

  if (frameworkMeta?.hasBackend) {
    options.push({
      value: 'builtin',
      label: `Use ${frameworkMeta.label} built-in`,
      hint: 'API routes, server actions',
    });
  }

  Object.entries(META.api.stacks).forEach(([key, meta]) => {
    options.push({ value: key, label: meta.label, hint: meta.hint });
  });

  if (!frameworkMeta?.hasBackend) {
    options.push({ value: undefined, label: 'None' });
  }

  const result = await select({
    message: `${appName} - Backend?`,
    options,
  });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

async function promptApp(index: number): Promise<App> {
  const appName = await promptText(`App ${index} - Name? (folder name)`, {
    defaultValue: `app-${index}`,
    placeholder: `app-${index}`,
    validate: (value) => {
      if (!value || value.trim() === '') return 'App name is required';
    },
  });

  const platform = await promptPlatform(`App ${index} - Platform?`);
  const framework = await promptFrameworkForPlatform(platform, `App ${index} - Framework?`);
  const backend = platform !== 'api' ? await promptBackendForApp(appName!, platform, framework!) : undefined;

  return { appName: appName!, platform, framework: framework!, backend };
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

  const appCount = await promptText<number>(
    'How many apps? Turborepo mode will be used if you have more than one app',
    {
      initialValue: '1',
      placeholder: '1',
      validate: (value) => {
        const num = Number(value);
        if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
      },
    },
  );

  for (let i = 0; i < Number(appCount); i++) {
    const app = await promptApp(i + 1);
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
  const config = await cli();

  const ctx: TemplateContext = {
    repo: config.apps.length > 1 ? 'turborepo' : 'single',
    ...config,
  };

  const templates = getAllTemplatesForContext(ctx);

  console.log('\nTemplates to generate:');
  console.log(templates);
}

main().catch(console.error);
