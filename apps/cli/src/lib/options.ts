import type { Option } from '@clack/prompts';
import { META } from '@/__meta__';
import type { MetaModules, MetaStack } from '@/types/meta';

export function transformModulesToGroupedOptions(modules: MetaModules): Record<string, Option<string>[]> {
  const groupedOptions: Record<string, Option<string>[]> = {};

  for (const [category, categoryModules] of Object.entries(modules)) {
    groupedOptions[category] = Object.entries(categoryModules).map(([moduleName, meta]) => ({
      value: moduleName,
      label: meta.label,
      hint: meta.hint,
    }));
  }

  return groupedOptions;
}

export function buildServerOptions(metaStack: MetaStack) {
  const serverOptions = Object.entries(META.server.stacks).map(([key, meta]) => ({
    value: key,
    label: meta.label,
    hint: meta.hint,
  }));

  if (metaStack.hasBackend) {
    serverOptions.unshift({
      value: 'none',
      label: `Use ${metaStack.label} built-in`,
      hint: 'API routes, server actions',
    });
  } else {
    serverOptions.push({
      value: 'none',
      label: 'None',
      hint: 'No server',
    });
  }

  return serverOptions;
}
