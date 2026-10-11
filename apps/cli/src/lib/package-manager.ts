import { execSync } from 'node:child_process';
import type { PackageManager, TemplateContext } from '@/types/ctx';

type SelectedPackageManager = NonNullable<PackageManager>;
type VersionReader = (pm: SelectedPackageManager) => string | undefined;

export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm'] as const satisfies readonly SelectedPackageManager[];

const TURBOREPO_DEFAULT_PACKAGE_MANAGER: SelectedPackageManager = 'npm';

export function readPackageManagerVersion(pm: SelectedPackageManager): string | undefined {
  try {
    return execSync(`${pm} --version`, { stdio: 'pipe' }).toString().trim();
  } catch {
    return undefined;
  }
}

export function findMissingPackageManager(
  ctx: TemplateContext,
  readVersion: VersionReader = readPackageManagerVersion,
): SelectedPackageManager | undefined {
  const required = ctx.pm ?? (ctx.repo === 'turborepo' ? TURBOREPO_DEFAULT_PACKAGE_MANAGER : undefined);
  return required && !readVersion(required) ? required : undefined;
}

export function missingPackageManagerMessage(pm: SelectedPackageManager): string {
  return `Package manager '${pm}' is not installed. Install ${pm}, or choose another with --pm (${PACKAGE_MANAGERS.join(', ')}).`;
}
