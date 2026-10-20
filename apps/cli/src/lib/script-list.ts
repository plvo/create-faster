import { META } from '@/__meta__';
import { getAppLibraries, getSelectedProjectAddons } from '@/lib/addon-utils';
import { collectInteractiveSteps } from '@/lib/interactive-steps';
import { getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand } from '@/lib/package-manager';
import { collectProductionSteps, type ScriptStep } from '@/lib/production-steps';
import { isWhenItem, resolveConditionals } from '@/lib/when';
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

const unwrap = <T>(item: Conditional<T>): T => (isWhenItem(item) ? (item.value as T) : item);

/** Every script name META describes, whichever choice declares it. */
const DESCRIBED_SCRIPT_NAMES: ReadonlySet<string> = new Set(
  [
    ...Object.values(META.stacks),
    ...Object.values(META.libraries),
    ...Object.values(META.project).flatMap(({ options }) => Object.values(options)),
    ...Object.values(META.blueprints),
    ...Object.values(META.repo.stacks),
  ].flatMap(({ scriptDescriptions = [], productionScripts = [] }: ScriptSource) =>
    [...scriptDescriptions, ...productionScripts].map((item) => unwrap(item).script),
  ),
);

/**
 * A script the package manager runs itself, which nobody runs as a command: `prepare` and the install hooks, and the
 * `pre` and `post` hook of a script META describes (`prebuild` for `build`, whether or not the project defines it).
 */
export function isLifecycleScript(script: string): boolean {
  if (INSTALL_LIFECYCLE_SCRIPTS.has(script)) return true;
  const hooked = script.startsWith('pre') ? script.slice(3) : script.startsWith('post') ? script.slice(4) : undefined;
  return hooked !== undefined && DESCRIBED_SCRIPT_NAMES.has(hooked);
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

function resolveDescriptions(items: Conditional<ScriptDescription>[], ctx: TemplateContext): ScriptDescription[] {
  return resolveConditionals(items, ctx).flatMap(({ script, description, readmeSection }) =>
    script !== undefined && description !== undefined
      ? [readmeSection ? { script, description, readmeSection } : { script, description }]
      : [],
  );
}

/** Every description the selected choices declare, scripts of the stacks first, then libraries, project addons, blueprint and repo type. */
export function collectScriptDescriptions(ctx: TemplateContext): ScriptDescription[] {
  const sources = [...stackSources(ctx), ...projectSources(ctx)];
  return resolveDescriptions(
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

/**
 * The commands the Scripts lists of the READMEs and `AGENTS.md` print: the root scripts of the generated project, each
 * with the sentence its choice declares in META (`scriptDescriptions`, and `productionScripts` for the production
 * ones). The scripts of the stacks come first, then the scripts an app runs in a terminal of its own, then the
 * production commands, then the scripts of the libraries, project addons, blueprint and repo type. A script the root
 * does not define is left out, and so are the scripts the package manager runs itself.
 */
export function collectScriptList(ctx: TemplateContext): ScriptListEntry[] {
  const rootScripts = getRootScripts(ctx);
  const listed = new Set<string>();

  const rootEntries = (sources: ScriptSource[]): ScriptListEntry[] =>
    resolveDescriptions(
      sources.flatMap(({ scriptDescriptions = [] }) => scriptDescriptions),
      ctx,
    ).flatMap(({ script, description, readmeSection }) => {
      const command = getScriptCommand(ctx, script);
      if (!(script in rootScripts) || isLifecycleScript(script) || listed.has(command)) return [];
      listed.add(command);
      return [readmeSection ? { command, description, readmeSection } : { command, description }];
    });

  const stackEntries = rootEntries(stackSources(ctx));
  const terminalAndProductionEntries = [...collectInteractiveSteps(ctx), ...collectProductionSteps(ctx)].filter(
    ({ command }) => !listed.has(command),
  );
  for (const { command } of terminalAndProductionEntries) listed.add(command);

  return [...stackEntries, ...terminalAndProductionEntries, ...rootEntries(projectSources(ctx))];
}
