import * as p from '@clack/prompts';
import { type Category, META } from '@/__meta__';
import type { Config } from './lib/schema';

export async function cli(partial: Partial<Config> = {}): Promise<Config> {
  p.intro('create-faster');

  const name = await promptText('Project name?', partial.name, {
    placeholder: 'my-app',
    defaultValue: 'my-app',
    validate: (value) => {
      if (!value) return 'Project name is required';
    },
  });

  const repo = await promptSelect('repo', 'Repository type?', partial.repo);
  const framework = await promptSelect('framework', 'Framework?', partial.framework, { allowNone: true });
  const backend = await promptSelect('backend', 'Backend?', partial.backend, { allowNone: true });
  const orm = await promptSelect('orm', 'ORM?', partial.orm, { allowNone: true });
  const database = await promptSelect('database', 'Database?', partial.database, {
    allowNone: true,
    skip: !orm,
  });
  const extras = await promptMultiselect('extras', 'Select extras:', partial.extras);

  p.outro('Configuration complete!');

  return {
    name,
    repo,
    framework,
    backend,
    orm,
    database,
    extras,
  };
}

function handleCancel(result: unknown): void {
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }
}

async function promptText(message: string, partial?: string, options?: Partial<p.TextOptions>): Promise<string> {
  if (partial) return partial;

  const result = await p.text({
    message,
    ...options,
  });

  handleCancel(result);
  return result as string;
}

async function promptSelect<C extends Category>(
  category: C,
  message: string,
  partial?: string,
  options?: { allowNone?: boolean; skip?: boolean },
): Promise<string | undefined> {
  if (partial) return partial;
  if (options?.skip) return undefined;

  const selectOptions: p.Option<string | undefined>[] = Object.entries(META[category]).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  if (options?.allowNone) {
    selectOptions.push({ value: undefined, label: 'None', hint: undefined });
  }

  const result = await p.select({ message, options: selectOptions });

  handleCancel(result);
  return result as string | undefined;
}

async function promptMultiselect<C extends Category>(
  category: C,
  message: string,
  partial?: string[],
): Promise<string[] | undefined> {
  if (partial) return partial;

  const selectOptions = Object.entries(META[category]).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  const result = await p.multiselect({ message, options: selectOptions, required: false });

  handleCancel(result);
  return result as string[] | undefined;
}
