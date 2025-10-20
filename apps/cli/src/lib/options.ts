import { log } from '@clack/prompts';
import { validateCompatibility } from './compatibility';
import type { FlagOptions } from './flags';
import type { Config } from './schema';
import { configSchema } from './schema';

export function validateOptions(flags: Partial<Config>): Config {
  const validated = configSchema.parse(flags);

  const errors = validateCompatibility(validated);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `- ${e.field}: ${e.message}`).join('\n');
    log.error(`Configuration incompatibilities detected:\n${errorMessages}`);
    process.exit(1);
  }

  return validated;
}

export function mergeOptions(flags: FlagOptions, prompted: Partial<Config>): Config {
  return { ...prompted, ...flags };
}
