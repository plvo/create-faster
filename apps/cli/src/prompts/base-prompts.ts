import {
  type ConfirmOptions,
  cancel,
  confirm,
  isCancel,
  log,
  type MultiSelectOptions,
  multiselect,
  type Option,
  type SelectOptions,
  select,
  type TextOptions,
  text,
} from '@clack/prompts';
import { META } from '@/__meta__';
import type { TemplateContext } from '@/types/ctx';
import type { Category } from '@/types/meta';

function filterOptionsByContext<C extends Category>(
  category: C,
  ctx: Partial<TemplateContext>,
): Option<string | undefined>[] {
  if (META[category].requires) {
    const isRequired = META[category].requires.every(
      (required) => required in ctx && Boolean((ctx as Record<string, unknown>)[required]),
    );
    if (!isRequired) {
      log.info(`${category} skipped (requires: ${META[category].requires.join(', ')})`);
      return [];
    }
  }

  return Object.entries(META[category].stacks)
    .filter(([_value, meta]) => {
      if (!meta.requires) return true;
      const isRequired = meta.requires.every(
        (required) => required in ctx && Boolean((ctx as Record<string, unknown>)[required]),
      );
      if (!isRequired) {
        log.info(`${meta.label} skipped because it requires ${meta.requires.join(', ')}`);
        return false;
      }
      return isRequired;
    })
    .map(([value, meta]) => ({ value, label: meta.label, hint: meta.hint }));
}

export async function promptText<T extends string | number = string>(
  message: string,
  options?: Partial<TextOptions>,
): Promise<T> {
  const result = await text({ message, ...options });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as T;
}

export async function promptSelect<C extends Category | undefined, R extends string | undefined>(
  category: C,
  message: string,
  ctx: Partial<TemplateContext>,
  options?: { allowNone?: boolean } & Partial<SelectOptions<string | undefined>>,
): Promise<R> {
  const selectOptions = category ? filterOptionsByContext(category, ctx) : (options?.options ?? []);

  if (selectOptions?.length === 0) {
    return undefined as R;
  }

  if (options?.allowNone) {
    selectOptions.push({ value: undefined, label: 'None' });
  }

  const result = await select({
    message,
    options: selectOptions,
    initialValue: selectOptions[0]?.value,
    ...options,
  });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as R;
}

export async function promptMultiselect<C extends Category>(
  category: C,
  message: string,
  ctx: Partial<TemplateContext>,
  options?: Partial<MultiSelectOptions<string>>,
): Promise<string[] | undefined> {
  const selectOptions = filterOptionsByContext(category, ctx);

  if (selectOptions.length === 0) {
    return undefined;
  }

  const result = await multiselect({ message, options: selectOptions, required: false, ...options });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result as string[] | undefined;
}

export async function promptConfirm(message: string, options?: Partial<ConfirmOptions>): Promise<boolean> {
  const result = await confirm({ message, ...options });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}
