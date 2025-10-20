import { hasAnyFlags, parseFlags } from '@/lib/flags';
import { mergeOptions, validateOptions } from '@/lib/options';
import type { Config } from '@/lib/schema';
import { getAllTemplatesForContext, type TemplateContext } from '@/lib/template-resolver';
import { cli } from './cli';

async function main() {
  const flags = parseFlags();

  let config: Config;

  if (hasAnyFlags(flags)) {
    const validated = validateOptions(flags);
    config = mergeOptions(validated, await cli(validated));
  } else {
    config = await cli();
  }

  const ctx: TemplateContext = {
    repo: config.repo || 'single',
    framework: config.framework,
    backend: config.backend,
    orm: config.orm,
    database: config.database,
    extras: config.extras,
  };

  const templates = getAllTemplatesForContext(ctx);

  console.log('\nTemplates to generate:');
  console.log(templates);
}

main().catch(console.error);
