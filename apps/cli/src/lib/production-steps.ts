import { getRootScripts } from '@/lib/package-json-generator';
import { getScriptCommand } from '@/lib/package-manager';
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

/** The production commands the generated root package.json defines: the README, AGENTS.md and the CLI summary print them. */
export function collectProductionSteps(ctx: TemplateContext): ProductionStep[] {
  const rootScripts = getRootScripts(ctx);

  return PRODUCTION_SCRIPTS.filter(({ script }) => script in rootScripts).map(({ script, description }) => ({
    description,
    command: getScriptCommand(ctx, script),
  }));
}
