import { META } from '@/__meta__';
import { getAppLibraries, getSelectedProjectAddons } from '@/lib/addon-utils';
import { collectInteractiveSteps } from '@/lib/interactive-steps';
import { getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand } from '@/lib/package-manager';
import { collectProductionSteps, type ScriptStep } from '@/lib/production-steps';
import { resolveScriptDescriptions } from '@/lib/script-description';
import type { TemplateContext } from '@/types/ctx';
import type { ScriptDescription } from '@/types/meta';
import type { Conditional } from '@/types/when';

interface ScriptListEntry extends ScriptStep {
  readmeSection?: string;
}

interface ScriptSource {
  scriptDescriptions?: Conditional<ScriptDescription>[];
  productionScripts?: Conditional<ScriptDescription>[];
}

const INSTALL_LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare']);

/** Every META entry that can describe a script, with a label that names it. */
export function listScriptSources(): { label: string; source: ScriptSource }[] {
  return [
    ...Object.entries(META.stacks).map(([name, source]) => ({ label: `stack ${name}`, source })),
    ...Object.entries(META.libraries).map(([name, source]) => ({ label: `library ${name}`, source })),
    ...Object.entries(META.project).flatMap(([category, { options }]) =>
      Object.entries(options).map(([name, source]) => ({ label: `${category} ${name}`, source })),
    ),
    ...Object.entries(META.blueprints).map(([name, source]) => ({ label: `blueprint ${name}`, source })),
    ...Object.entries(META.repo.stacks).map(([name, source]) => ({ label: `repo ${name}`, source })),
  ];
}

/**
 * A script the package manager runs itself, which nobody runs as a command: `prepare` and the install hooks, and the
 * `pre` and `post` hook of a script the project defines (`predev` when it has `dev`).
 */
export function isLifecycleScript(script: string, rootScripts: Record<string, string>): boolean {
  if (INSTALL_LIFECYCLE_SCRIPTS.has(script)) return true;
  const hooked = script.startsWith('pre') ? script.slice(3) : script.startsWith('post') ? script.slice(4) : undefined;
  return hooked !== undefined && hooked in rootScripts;
}

/** The sources whose scripts the stacks of the apps describe. */
function stackSources(ctx: TemplateContext): ScriptSource[] {
  return [...new Set(ctx.apps.map((app) => app.stackName))].map((stack) => META.stacks[stack]);
}

/** The sources of everything the apps and the project add to the stacks: libraries, project addons, blueprint, repo type. */
function projectSources(ctx: TemplateContext): ScriptSource[] {
  const blueprint = ctx.blueprint ? META.blueprints[ctx.blueprint] : undefined;
  return [
    ...ctx.apps.flatMap((app) => getAppLibraries(app).map(({ library }) => library)),
    ...getSelectedProjectAddons(ctx),
    ...(blueprint ? [blueprint] : []),
    META.repo.stacks[ctx.repo],
  ];
}

/** Every description the selected choices declare, scripts of the stacks first, then libraries, project addons, blueprint and repo type. */
export function collectScriptDescriptions(ctx: TemplateContext): ScriptDescription[] {
  const sources = [...stackSources(ctx), ...projectSources(ctx)];
  return resolveScriptDescriptions(
    sources.flatMap(({ scriptDescriptions = [], productionScripts = [] }) => [
      ...scriptDescriptions,
      ...productionScripts,
    ]),
    ctx,
  );
}

/** The sentence of a script, from the first choice that declares it. */
export function describeScript(ctx: TemplateContext, script: string): string | undefined {
  return collectScriptDescriptions(ctx).find((declared) => declared.script === script)?.description;
}

/** Entries that share the name before the first `:` end up next to each other, at the place of the first one. */
function groupByNamePrefix<T extends { script: string }>(entries: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const prefix = entry.script.split(':')[0] as string;
    groups.set(prefix, [...(groups.get(prefix) ?? []), entry]);
  }
  return [...groups.values()].flat();
}

/**
 * The commands the Scripts lists of the READMEs and `AGENTS.md` print: the root scripts of the generated project, each
 * with the sentence its choice declares in META (`scriptDescriptions`, and `productionScripts` for the production
 * ones). The scripts of the stacks come first, then the scripts an app runs in a terminal of its own, then the
 * production commands, then the scripts of the libraries, project addons, blueprint and repo type, the scripts
 * that share a prefix (`db:push`, `db:seed`) kept together. A script the root does not define is left out, and so are
 * the scripts the package manager runs itself.
 */
export function collectScriptList(ctx: TemplateContext): ScriptListEntry[] {
  const rootScripts = getRootScripts(ctx);
  const listed = new Set<string>();

  const rootEntries = (sources: ScriptSource[]) =>
    resolveScriptDescriptions(
      sources.flatMap(({ scriptDescriptions = [] }) => scriptDescriptions),
      ctx,
    ).flatMap(({ script, description, readmeSection }) => {
      const command = getScriptCommand(ctx, script);
      if (!(script in rootScripts) || isLifecycleScript(script, rootScripts) || listed.has(command)) return [];
      listed.add(command);
      return [{ script, entry: readmeSection ? { command, description, readmeSection } : { command, description } }];
    });

  const stackEntries = rootEntries(stackSources(ctx));
  const terminalAndProductionEntries = [...collectInteractiveSteps(ctx), ...collectProductionSteps(ctx)].filter(
    ({ command }) => !listed.has(command),
  );
  for (const { command } of terminalAndProductionEntries) listed.add(command);
  const projectEntries = groupByNamePrefix(rootEntries(projectSources(ctx)));

  return [
    ...stackEntries.map(({ entry }) => entry),
    ...terminalAndProductionEntries,
    ...projectEntries.map(({ entry }) => entry),
  ];
}
