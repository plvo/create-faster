import { isCancel, SelectPrompt } from '@clack/core';
import { cancel, groupMultiselect } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { transformModulesToGroupedOptions } from '@/lib/options';
import type { MetaApp, MetaModules, MetaServer } from '@/types/meta';

export async function selectStackPrompt(message: string): Promise<MetaApp | MetaServer> {
  const SelectStackPrompt = new SelectPrompt({
    options: [
      ...Object.entries(META.app.stacks).map(([key, meta]) => ({
        value: key as MetaApp,
        label: meta.label,
        hint: meta.hint,
        section: 'Web / Mobile App',
      })),
      ...Object.entries(META.server.stacks).map(([key, meta]) => ({
        value: key as MetaServer,
        label: meta.label,
        hint: meta.hint,
        section: 'Server / API',
      })),
    ],

    render() {
      let output = `${message}\n`;
      let currentSection = '';

      this.options.forEach((option, i) => {
        if (option.section !== currentSection) {
          currentSection = option.section;
          output += `\n  ${color.underline(color.bold(currentSection))}\n`;
        }

        const isSelected = i === this.cursor;

        const prefix = isSelected ? '›' : ' ';
        const hint = isSelected && option.hint ? color.dim(`(${option.hint})`) : '';

        output += `  ${prefix} ${option.label} ${hint}\n`;
      });

      return output;
    },
  });

  const result = await SelectStackPrompt.prompt();

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

export async function multiselectModulesPrompt(
  modules: MetaModules,
  message: string,
  required: boolean,
): Promise<string[]> {
  const groupedModules = transformModulesToGroupedOptions(modules);

  if (Object.keys(groupedModules).length === 0) {
    return [];
  }

  const result = await groupMultiselect({
    options: groupedModules,
    message,
    required,
    selectableGroups: true,
  });

  if (isCancel(result)) {
    cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}
