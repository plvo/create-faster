// ABOUTME: Custom prompts for stack and addon selection
// ABOUTME: Groups addons by type for better UX

import { isCancel, SelectPrompt } from '@clack/core';
import { cancel, groupMultiselect, select, type Option } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { S_CONNECT_LEFT, S_GRAY_BAR, symbol } from '@/tui/symbols';
import type { StackName } from '@/types/meta';
import { isAddonCompatible, getAddonsByType } from '@/lib/addon-utils';

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

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}

export async function multiselectAddonsPrompt(
  stackName: StackName,
  message: string,
  required: boolean,
): Promise<string[]> {
  const addonGroups = getAddonsByType(META);
  const moduleAddons = addonGroups.module ?? [];

  const compatibleAddons = moduleAddons.filter((addonName) => {
    const addon = META.addons[addonName];
    return addon && isAddonCompatible(addon, stackName);
  });

  if (compatibleAddons.length === 0) {
    return [];
  }

  const groupedOptions: Record<string, Option<string>[]> = {
    Modules: compatibleAddons.map((addonName) => {
      const addon = META.addons[addonName];
      return {
        value: addonName,
        label: addon.label,
        hint: addon.hint,
      };
    }),
  };

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

export async function selectGlobalAddonPrompt(type: 'orm' | 'database', message: string): Promise<string | undefined> {
  const addonGroups = getAddonsByType(META);
  const addons = addonGroups[type] ?? [];

  if (addons.length === 0) {
    return undefined;
  }

  const options: { value: string | undefined; label: string; hint?: string }[] = [
    { value: undefined, label: 'None', hint: 'Skip this option' },
    ...addons.map((addonName) => {
      const addon = META.addons[addonName];
      return {
        value: addonName,
        label: addon.label,
        hint: addon.hint,
      };
    }),
  ];

  const result = await select({
    message,
    options,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}

export async function multiselectGlobalAddonsPrompt(
  type: 'extra',
  message: string,
  required: boolean,
): Promise<string[]> {
  const addonGroups = getAddonsByType(META);
  const addons = addonGroups[type] ?? [];

  if (addons.length === 0) {
    return [];
  }

  const groupedOptions: Record<string, Option<string>[]> = {
    [type.charAt(0).toUpperCase() + type.slice(1)]: addons.map((addonName) => {
      const addon = META.addons[addonName];
      return {
        value: addonName,
        label: addon.label,
        hint: addon.hint,
      };
    }),
  };

  const result = await groupMultiselect({
    options: groupedOptions,
    message,
    required,
    selectableGroups: false,
  });

  if (isCancel(result)) {
    cancel('👋 Bye');
    process.exit(0);
  }

  return result;
}
