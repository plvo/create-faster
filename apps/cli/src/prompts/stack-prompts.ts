import { isCancel, SelectPrompt } from '@clack/core';
import { cancel, groupMultiselect, type Option } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { S_CONNECT_LEFT, S_GRAY_BAR, symbol } from '@/tui/symbols';
import type { MetaModules } from '@/types/meta';

export async function selectStackPrompt(message: string): Promise<string> {
  const SelectStackPrompt = new SelectPrompt({
    options: Object.entries(META.stacks)
      // Sort by type to group app stacks together and server stacks together
      .sort(([, a], [, b]) => {
        if (a.type === b.type) return 0;
        return a.type === 'app' ? -1 : 1;
      })
      .map(([key, meta]) => ({
        value: key,
        label: meta.label,
        hint: meta.hint,
        section: meta.type === 'app' ? 'Web / Mobile App' : 'Server / API',
      })),

    render() {
      let output = `${S_GRAY_BAR}\n${symbol(this.state)} ${message}`;
      let currentSection = '';

      this.options.forEach((option, i) => {
        if (option.section !== currentSection) {
          currentSection = option.section;
          output += `\n${S_GRAY_BAR}\n${color.gray(S_CONNECT_LEFT)} ${color.underline(color.bold(currentSection))}`;
        }

        const isSelected = i === this.cursor;
        const hint = isSelected && option.hint ? color.dim(`(${option.hint})`) : '';

        output += `\n${S_GRAY_BAR} ${symbol(isSelected ? 'active' : 'submit')} ${option.label} ${hint}`;
      });

      return output;
    },
  });

  const result = await SelectStackPrompt.prompt();

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}

export async function multiselectModulesPrompt(
  modules: MetaModules,
  message: string,
  required: boolean,
): Promise<string[]> {
  const groupedOptions: Record<string, Option<string>[]> = {};

  for (const [category, categoryModules] of Object.entries(modules)) {
    groupedOptions[category] = Object.entries(categoryModules).map(([moduleName, meta]) => ({
      value: moduleName,
      label: meta.label,
      hint: meta.hint,
    }));
  }

  if (Object.keys(groupedOptions).length === 0) {
    return [];
  }

  const result = await groupMultiselect({
    options: groupedOptions,
    message,
    required,
    selectableGroups: true,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}
