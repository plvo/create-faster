import { isCancel, SelectPrompt } from '@clack/core';
import { cancel } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import type { MetaApp, MetaServer } from '@/types/meta';

export async function selectStack(message: string): Promise<MetaApp | MetaServer> {
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

        const opt = isSelected
          ? color.bgCyan(`  ${prefix} ${option.label} ${hint}\n`)
          : `  ${prefix} ${option.label} ${hint}\n`;

        output += opt;
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

console.log(await selectStack('Select your stack:'));
