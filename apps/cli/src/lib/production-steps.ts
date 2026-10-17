import { getAppScripts, getRootScripts } from '@/lib/package-json-generator';
import { getAppScriptCommand, getScriptCommand } from '@/lib/package-manager';
import type { TemplateContext } from '@/types/ctx';

interface ProductionStep {
  description: string;
  command: string;
}

/** The scripts that build, serve or ship a project, in the order a user runs them. */
const PRODUCTION_SCRIPTS = [
  { script: 'build', description: 'Build for production' },
  { script: 'build:cf', description: 'Build the Worker bundle' },
  { script: 'start', description: 'Start the app' },
  { script: 'preview', description: 'Preview the production build locally' },
  { script: 'deploy', description: 'Deploy' },
];

/** The production commands the generated project defines: the README, AGENTS.md and the CLI summary print them. */
export function collectProductionSteps(ctx: TemplateContext): ProductionStep[] {
  const rootScripts = getRootScripts(ctx);
  const appScripts = getAppScripts(ctx);

  return PRODUCTION_SCRIPTS.flatMap(({ script, description }) => {
    if (script in rootScripts) return [{ description, command: getScriptCommand(ctx, script) }];
    if (appScripts.includes(script)) return [{ description, command: getAppScriptCommand(ctx, script) }];
    return [];
  });
}
