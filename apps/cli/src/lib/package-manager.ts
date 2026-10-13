import { execSync } from 'node:child_process';
import { PACKAGE_MANAGERS } from '@/lib/constants';
import type { PackageManagerName, TemplateContext } from '@/types/ctx';

type VersionReader = (pm: PackageManagerName) => string | undefined;

const TURBOREPO_DEFAULT_PACKAGE_MANAGER: PackageManagerName = 'npm';

function runVersionCommand(pm: PackageManagerName): string | undefined {
  try {
    return execSync(`${pm} --version`, { stdio: 'pipe' }).toString().trim();
  } catch {
    return undefined;
  }
}

export function createCachedVersionReader(read: VersionReader): VersionReader {
  const versions = new Map<PackageManagerName, string | undefined>();
  return (pm) => {
    if (!versions.has(pm)) versions.set(pm, read(pm));
    return versions.get(pm);
  };
}

export const readPackageManagerVersion = createCachedVersionReader(runVersionCommand);

export function resolvePackageManager(ctx: TemplateContext): PackageManagerName | undefined {
  return ctx.pm ?? (ctx.repo === 'turborepo' ? TURBOREPO_DEFAULT_PACKAGE_MANAGER : undefined);
}

export function findMissingPackageManager(
  ctx: TemplateContext,
  readVersion: VersionReader = readPackageManagerVersion,
): PackageManagerName | undefined {
  const required = resolvePackageManager(ctx);
  return required && !readVersion(required) ? required : undefined;
}

export function missingPackageManagerMessage(pm: PackageManagerName): string {
  return `Package manager '${pm}' is not installed. Install ${pm}, or choose another with --pm (${PACKAGE_MANAGERS.join(', ')}).`;
}

export function getPackageManager(
  pm: PackageManagerName,
  readVersion: VersionReader = readPackageManagerVersion,
): string {
  const version = readVersion(pm);
  if (!version) throw new Error(missingPackageManagerMessage(pm));
  return `${pm}@${version}`;
}

export function getPackageManagerField(ctx: TemplateContext): string | undefined {
  const pm = resolvePackageManager(ctx);
  return pm ? getPackageManager(pm) : undefined;
}

const PACKAGE_MANAGER_RUNNERS: Record<PackageManagerName, string> = {
  bun: 'bunx',
  npm: 'npx',
  pnpm: 'pnpm dlx',
};

const COMMAND_FALLBACK_PACKAGE_MANAGER: PackageManagerName = 'npm';

function resolveCommandPackageManager(ctx: TemplateContext): PackageManagerName {
  return resolvePackageManager(ctx) ?? COMMAND_FALLBACK_PACKAGE_MANAGER;
}

/** A package.json script as every package manager runs it: a bare `bun build` is Bun's bundler, `npm dev` is unknown. */
export function getScriptCommand(ctx: TemplateContext, script: string): string {
  return `${resolveCommandPackageManager(ctx)} run ${script}`;
}

/** The command that runs a package binary without installing it. */
export function getPackageRunner(ctx: TemplateContext): string {
  return PACKAGE_MANAGER_RUNNERS[resolveCommandPackageManager(ctx)];
}
