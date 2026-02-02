// ABOUTME: Helper functions for working with META addons
// ABOUTME: Grouping, compatibility checking, and dependency validation

import type { Meta, MetaAddon, AddonType, StackName } from '@/types/meta';

let addonGroupsCache: Record<AddonType, string[]> | null = null;

export function getAddonsByType(meta: Meta): Record<AddonType, string[]> {
  if (addonGroupsCache) return addonGroupsCache;

  addonGroupsCache = Object.entries(meta.addons).reduce(
    (acc, [name, addon]) => {
      acc[addon.type] ??= [];
      acc[addon.type].push(name);
      return acc;
    },
    {} as Record<AddonType, string[]>,
  );

  return addonGroupsCache;
}

export function isAddonCompatible(addon: MetaAddon, stackName: StackName): boolean {
  if (!addon.support?.stacks) return true;
  if (addon.support.stacks === 'all') return true;
  return addon.support.stacks.includes(stackName);
}

export function areAddonDependenciesMet(addon: MetaAddon, selectedAddons: string[]): boolean {
  if (!addon.support?.addons || addon.support.addons.length === 0) return true;
  return addon.support.addons.some((dep) => selectedAddons.includes(dep));
}

export function clearAddonGroupsCache(): void {
  addonGroupsCache = null;
}
