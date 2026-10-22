import { META } from '@/__meta__';
import { getAppLibraries, getSelectedBlueprint, getSelectedProjectAddons } from '@/lib/addon-utils';
import type { TemplateContext } from '@/types/ctx';
import type { GeneratedFile, GeneratedFileTool } from '@/types/meta';

function globFor(file: GeneratedFile, tool: GeneratedFileTool): string | undefined {
  if (typeof file === 'string') return file;
  const form = file.as[tool];
  return form === false ? undefined : (form ?? file.glob);
}

/**
 * The patterns one tool must ignore: the committed files that the selected project addons, libraries, stacks and
 * blueprint declare their tools write, each once, in that order.
 */
export function collectGeneratedFiles(ctx: TemplateContext, tool: GeneratedFileTool): string[] {
  const stackNames = [...new Set(ctx.apps.map((app) => app.stackName))];
  const declared = [
    ...getSelectedProjectAddons(ctx).flatMap((addon) => addon.generatedFiles ?? []),
    ...ctx.apps.flatMap((app) => getAppLibraries(app).flatMap(({ library }) => library.generatedFiles ?? [])),
    ...stackNames.flatMap((name) => META.stacks[name].generatedFiles ?? []),
    ...(getSelectedBlueprint(ctx)?.generatedFiles ?? []),
  ];
  const patterns = declared.flatMap((file) => globFor(file, tool) ?? []);
  return [...new Set(patterns)];
}
