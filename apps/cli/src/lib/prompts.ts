import { cancel, isCancel, multiselect, type Option, select, type TextOptions, text } from '@clack/prompts';
import { META } from '@/__meta__';
import type { Category } from '@/types';

export async function promptText<T extends string | number = string>(
  message: string,
  options?: Partial<Omit<TextOptions, 'message'>>,
): Promise<T | undefined> {
  const result = await text({
    message,
    ...options,
  });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as T | undefined;
}

export async function promptSelect<C extends Category>(
  category: C,
  message: string,
  options?: { allowNone?: boolean; skip?: boolean },
): Promise<string | undefined> {
  if (options?.skip) return undefined;

  const selectOptions: Option<string | undefined>[] = Object.entries(META[category].stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  if (options?.allowNone) {
    selectOptions.push({ value: undefined, label: 'None' });
  }

  const result = await select({ message, options: selectOptions });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as string | undefined;
}

export async function promptMultiselect<C extends Category>(
  category: C,
  message: string,
): Promise<string[] | undefined> {
  const selectOptions = Object.entries(META[category].stacks).map(([value, meta]) => ({
    value,
    label: meta.label,
    hint: meta.hint,
  }));

  const result = await multiselect({ message, options: selectOptions, required: false });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as string[] | undefined;
}
