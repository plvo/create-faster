import { resolveConditionals } from '@/lib/when';
import type { TemplateContext } from '@/types/ctx';
import type { ScriptDescription } from '@/types/meta';
import type { Conditional } from '@/types/when';

/** The descriptions that apply to the project: `$when` items are resolved and the ones that resolve to nothing dropped. */
export function resolveScriptDescriptions(
  declared: Conditional<ScriptDescription>[],
  ctx: TemplateContext,
): ScriptDescription[] {
  return resolveConditionals(declared, ctx).flatMap(({ script, description, readmeSection }) =>
    script !== undefined && description !== undefined
      ? [readmeSection ? { script, description, readmeSection } : { script, description }]
      : [],
  );
}
