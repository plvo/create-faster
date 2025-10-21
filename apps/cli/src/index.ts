/** biome-ignore-all lint/style/noNonNullAssertion: nope */

import * as p from '@clack/prompts';
import { META } from '@/__meta__';
import type { Config } from '@/lib/schema';
import { getAllTemplatesForContext } from '@/lib/template-resolver';
import type { App, Platform, TemplateContext } from '@/types';
import { promptMultiselect, promptSelect, promptText } from './lib/prompts';

async function promptPlatform(message: string): Promise<Platform> {
  const result = await p.select({
    message,
    options: [
      { value: 'web' as Platform, label: 'Web', hint: 'Next.js, Astro...' },
      { value: 'api' as Platform, label: 'API/Server', hint: 'Hono, Express...' },
      { value: 'mobile' as Platform, label: 'Mobile', hint: 'Expo, React Native' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result as Platform;
}

async function promptFrameworkForPlatform(platform: Platform, message: string): Promise<string | undefined> {
  const stacks = META[platform].stacks;

  const options = Object.entries(stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  const result = await p.select({ message, options });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result as string;
}

async function promptBackendForApp(
  appName: string,
  platform: Platform,
  framework: string,
): Promise<string | undefined> {
  const frameworkMeta = META[platform].stacks[framework];

  const options: p.Option<string | undefined>[] = [];

  // Si framework a backend intégré
  if (frameworkMeta?.hasBackend) {
    options.push({
      value: 'builtin',
      label: `Use ${frameworkMeta.label} built-in`,
      hint: 'API routes, server actions',
    });
  }

  // Toujours proposer backends dédiés
  Object.entries(META.api.stacks).forEach(([key, meta]) => {
    options.push({
      value: key,
      label: meta.label,
      hint: meta.hint,
    });
  });

  // None seulement si le framework n'a pas de backend intégré
  if (!frameworkMeta?.hasBackend) {
    options.push({ value: undefined, label: 'None' });
  }

  const result = await p.select({
    message: `${appName} - Backend?`,
    options,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result as string | undefined;
}

async function promptApp(index: number): Promise<App> {
  const name = await promptText(`App ${index} - Name? (folder name)`, {
    defaultValue: `app-${index}`,
    placeholder: `app-${index}`,
    validate: (value) => {
      if (!value || value.trim() === '') return 'App name is required';
    },
  });

  const platform = await promptPlatform(`App ${index} - Platform?`);
  const framework = await promptFrameworkForPlatform(platform, `App ${index} - Framework?`);
  const backend = platform !== 'api' ? await promptBackendForApp(name || 'app', platform, framework || '') : undefined;

  return { name: name!, platform, framework: framework!, backend };
}

async function cli(): Promise<Config> {
  p.intro('create-faster');

  const name = await promptText('Project name?', {
    placeholder: 'my-app',
    initialValue: 'my-app',
    validate: (value) => {
      if (!value || value.trim() === '') return 'Project name is required';
    },
  });

  const appCount = await promptText<number>('How many apps?', {
    initialValue: '1',
    placeholder: '1',
    validate: (value) => {
      const num = Number(value);
      if (Number.isNaN(num) || num < 1) return 'Must be a number >= 1';
    },
  });

  const apps: App[] = [];

  for (let i = 0; i < Number(appCount); i++) {
    const app = await promptApp(i + 1);
    apps.push(app);
  }

  const database = await promptSelect('database', 'Database?', { allowNone: true });
  const orm = await promptSelect('orm', 'ORM?', { allowNone: true, skip: !database });
  const extras = await promptMultiselect('extras', 'Extras?');

  p.outro('Configuration complete!');

  return { name: name!, apps, orm, database, extras };
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
