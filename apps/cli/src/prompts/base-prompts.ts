import {
  type ConfirmOptions,
  cancel,
  confirm,
  isCancel,
  type SelectOptions,
  select,
  type TextOptions,
  text,
} from '@clack/prompts';
export async function promptText<T extends string | number = string>(
  message: string,
  options?: Partial<TextOptions>,
): Promise<T> {
  const result = await text({ message, ...options });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result as T;
}

export async function promptSelect<R extends string | undefined>(
  message: string,
  options?: Partial<SelectOptions<string | undefined>>,
): Promise<R> {
  const selectOptions = options?.options ?? [];

  if (selectOptions?.length === 0) {
    return undefined as R;
  }

  const result = await select({
    message,
    options: selectOptions,
    initialValue: selectOptions[0]?.value,
    ...options,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result as R;
}

export async function promptConfirm(message: string, options?: Partial<ConfirmOptions>): Promise<boolean> {
  const result = await confirm({ message, ...options });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}
