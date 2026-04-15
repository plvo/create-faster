import { isCancel, SelectPrompt } from '@clack/core';
import { groupMultiselect, type Option, select } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { isLibraryCompatible } from '@/lib/addon-utils';
import { handlePromptCancel } from '@/prompts/base-prompts';
import { S_CONNECT_LEFT, S_GRAY_BAR, symbol } from '@/tui/symbols';
import type { MetaProjectCategory, ProjectCategoryName, StackName } from '@/types/meta';

export async function selectStackPrompt(message: string): Promise<string> {
  const SelectStackPrompt = new SelectPrompt({
    options: Object.entries(META.stacks)
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

  if (isCancel(result)) handlePromptCancel();

  return result;
}

export async function multiselectLibrariesPrompt(
  stackName: StackName,
  message: string,
  required: boolean,
): Promise<string[]> {
  const compatibleLibraries = Object.entries(META.libraries)
    .filter(([, lib]) => isLibraryCompatible(lib, stackName))
    .map(([name]) => name);

  if (compatibleLibraries.length === 0) {
    return [];
  }

  const groupedOptions: Record<string, Option<string>[]> = {};
  for (const libraryName of compatibleLibraries) {
    const library = META.libraries[libraryName];
    if (!library) continue;
    const group = library.category ?? 'Other';
    if (!groupedOptions[group]) groupedOptions[group] = [];
    groupedOptions[group].push({
      value: libraryName,
      label: library.label,
      hint: library.hint,
    });
  }

  const result = await groupMultiselect({
    options: groupedOptions,
    message,
    required,
    selectableGroups: true,
  });

  if (isCancel(result)) handlePromptCancel();

  return result;
}

export async function selectBlueprintPrompt(message: string): Promise<string> {
  const options = Object.entries(META.blueprints)
    .sort(([, a], [, b]) => a.category.localeCompare(b.category))
    .map(([key, bp]) => ({
      value: key,
      label: bp.label,
      hint: bp.hint,
      section: bp.category,
    }));

  const BlueprintPrompt = new SelectPrompt({
    options,

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

  const result = await BlueprintPrompt.prompt();

  if (isCancel(result)) handlePromptCancel();

  return result;
}

export async function promptProjectCategorySingle(category: MetaProjectCategory): Promise<string | undefined> {
  const options: { value: string | undefined; label: string; hint?: string }[] = [
    { value: undefined, label: 'None', hint: 'Skip this option' },
    ...Object.entries(category.options).map(([name, addon]) => ({
      value: name,
      label: addon.label,
      hint: addon.hint,
    })),
  ];

  const result = await select({
    message: category.prompt,
    options,
  });

  if (isCancel(result)) handlePromptCancel();

  return result;
}

export async function promptProjectCategoryMulti(
  category: MetaProjectCategory,
  categoryName: string,
): Promise<string[]> {
  const groupLabel = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);

  const groupedOptions: Record<string, Option<string>[]> = {
    [groupLabel]: Object.entries(category.options).map(([name, addon]) => ({
      value: name,
      label: addon.label,
      hint: addon.hint,
    })),
  };

  const result = await groupMultiselect({
    options: groupedOptions,
    message: category.prompt,
    required: false,
    selectableGroups: false,
  });

  if (isCancel(result)) handlePromptCancel();

  return result;
}

export async function promptProjectCategory(categoryName: ProjectCategoryName): Promise<string | string[] | undefined> {
  const category = META.project[categoryName];

  if (category.selection === 'single') {
    return promptProjectCategorySingle(category);
  }
  return promptProjectCategoryMulti(category, categoryName);
}
