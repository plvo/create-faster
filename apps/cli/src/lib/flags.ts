import { program } from 'commander';
import type { Config } from './schema';

export type FlagOptions = Partial<Config>;

export function parseFlags(): FlagOptions {
  program
    .name('create-faster')
    .description('A quick way to create a new project')
    .option('--name <string>', 'Project name')
    .option('--repo <type>', 'Repository type (single|turborepo)')
    .option('--framework <type>', 'Framework (nextjs)')
    .option('--backend <type>', 'Backend (hono)')
    .option('--orm <type>', 'ORM (prisma|drizzle)')
    .option('--database <type>', 'Database (postgres)')
    .option('--extras <items...>', 'Extras (biome, git, husky)')
    .parse();

  return program.opts<FlagOptions>();
}

export function hasAnyFlags(flags: FlagOptions): boolean {
  return Object.keys(flags).length > 0;
}
