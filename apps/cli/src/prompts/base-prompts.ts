import { SelectPrompt } from '@clack/core';
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
import color from 'picocolors';
import { S_GRAY_BAR, S_RADIO_DISABLED, symbol } from '@/tui/symbols';

export function handlePromptCancel(): never {
  cancel('👋 Bye');
  process.exit(1);
}

export async function promptText<T extends string | number = string>(
  message: string,
  options?: Partial<TextOptions>,
): Promise<T> {
  const { validate, defaultValue } = options ?? {};
  const result = await text({
    message,
    ...options,
    validate: validate && ((value) => validate(value || defaultValue || '')),
  });

  if (isCancel(result)) handlePromptCancel();

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

  if (isCancel(result)) handlePromptCancel();

  return result as R;
}

export interface DisableableChoice {
  value: string | undefined;
  label: string;
  hint?: string;
  disabledReason?: string;
}

type SelectStreams = Pick<ConstructorParameters<typeof SelectPrompt>[0], 'input' | 'output'>;

export async function promptSelectWithDisabled<R extends string | undefined>(
  message: string,
  choices: DisableableChoice[],
  streams?: SelectStreams,
): Promise<R> {
  const selectable = choices.filter((choice) => !choice.disabledReason);

  const Prompt = new SelectPrompt({
    ...streams,
    options: selectable,

    render() {
      let output = `${S_GRAY_BAR}\n${symbol(this.state)} ${message}`;
      const active = this.options[this.cursor];

      for (const choice of choices) {
        if (choice.disabledReason) {
          output += `\n${S_GRAY_BAR} ${color.dim(S_RADIO_DISABLED)} ${color.dim(choice.label)}  ${color.red('✕')} ${color.dim(choice.disabledReason)}`;
          continue;
        }

        const isActive = choice.value === active?.value;
        const hint = isActive && choice.hint ? color.dim(`(${choice.hint})`) : '';
        output += `\n${S_GRAY_BAR} ${symbol(isActive ? 'active' : 'submit')} ${choice.label} ${hint}`;
      }

      return output;
    },
  });

  const result = await Prompt.prompt();

  if (isCancel(result)) handlePromptCancel();

  return result as R;
}

export async function promptConfirm(message: string, options?: Partial<ConfirmOptions>): Promise<boolean> {
  const result = await confirm({ message, ...options });

  if (isCancel(result)) handlePromptCancel();

  return result;
}
