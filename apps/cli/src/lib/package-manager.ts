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

/** `pnpm dlx` always downloads the latest release, so a binary the project installs runs through `pnpm exec`. */
const PACKAGE_MANAGER_BINARY_RUNNERS: Record<PackageManagerName, string> = {
  bun: 'bunx',
  npm: 'npx',
  pnpm: 'pnpm exec',
};

const COMMAND_FALLBACK_PACKAGE_MANAGER: PackageManagerName = 'npm';

export function resolveCommandPackageManager(ctx: TemplateContext): PackageManagerName {
  return resolvePackageManager(ctx) ?? COMMAND_FALLBACK_PACKAGE_MANAGER;
}

/** npm keeps the flags that follow the script name for itself, so it needs `--` before the script's own. */
const PACKAGE_MANAGER_SCRIPT_ARGS_SEPARATOR: Record<PackageManagerName, string> = {
  bun: '',
  npm: '-- ',
  pnpm: '',
};

/** A package.json script as every package manager runs it: a bare `bun build` is Bun's bundler, `npm dev` is unknown. */
export function getScriptCommand(ctx: TemplateContext, script: string, args?: string): string {
  const pm = resolveCommandPackageManager(ctx);
  const command = `${pm} run ${script}`;
  return args ? `${command} ${PACKAGE_MANAGER_SCRIPT_ARGS_SEPARATOR[pm]}${args}` : command;
}

/** Bun runs a TypeScript file itself; Node needs a loader. */
const PACKAGE_MANAGER_TYPESCRIPT_RUNNERS: Record<PackageManagerName, string> = {
  bun: 'bun',
  npm: 'tsx',
  pnpm: 'tsx',
};

export function getTypeScriptRunner(ctx: TemplateContext): string {
  return PACKAGE_MANAGER_TYPESCRIPT_RUNNERS[resolveCommandPackageManager(ctx)];
}

/** A script only the apps define: a turborepo root has none, so it runs from the app directory. */
export function getAppScriptCommand(ctx: TemplateContext, script: string): string {
  const command = getScriptCommand(ctx, script);
  return ctx.repo === 'turborepo' ? `cd apps/<app> && ${command}` : command;
}

/** A command run from a directory of the workspace; the subshell leaves the shell where it was, so steps paste in order. */
function getCommandInDirectory(directory: string, command: string): string {
  return `(cd ${directory} && ${command})`;
}

/** A script of one app run from the workspace root. */
export function getScriptCommandInApp(ctx: TemplateContext, script: string, appName: string): string {
  return getCommandInDirectory(`apps/${appName}`, getScriptCommand(ctx, script));
}

/** A single repo keeps everything at its root, so only a turborepo changes directory. */
export function getCommandInWorkspaceDirectory(ctx: TemplateContext, directory: string, command: string): string {
  return ctx.repo === 'turborepo' ? getCommandInDirectory(directory, command) : command;
}

/** The command that runs a package binary without installing it. */
export function getPackageRunner(ctx: TemplateContext): string {
  return PACKAGE_MANAGER_RUNNERS[resolveCommandPackageManager(ctx)];
}

/** The command that runs a binary a dependency of the project installed (`wrangler`), in the version the project pins. */
export function getInstalledBinaryRunner(ctx: TemplateContext): string {
  return PACKAGE_MANAGER_BINARY_RUNNERS[resolveCommandPackageManager(ctx)];
}

/**
 * The root package.json field a package manager reads its install-script policy from. pnpm reads `pnpm-workspace.yaml`.
 * Bun blocks untrusted scripts on its own, and its `trustedDependencies` can only list packages while replacing its
 * built-in trusted list, so declaring one would block packages Bun runs today.
 */
const PACKAGE_MANAGER_INSTALL_SCRIPTS_FIELDS: Partial<Record<PackageManagerName, string>> = {
  npm: 'allowScripts',
};

export function getInstallScriptsField(ctx: TemplateContext): string | undefined {
  return PACKAGE_MANAGER_INSTALL_SCRIPTS_FIELDS[resolveCommandPackageManager(ctx)];
}
