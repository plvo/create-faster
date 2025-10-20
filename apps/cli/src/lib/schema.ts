import { z } from 'zod';
import { META } from '@/__meta__';

const apiStackKeys = Object.keys(META.api.stacks) as [string, ...string[]];
const ormStackKeys = Object.keys(META.orm.stacks) as [string, ...string[]];
const databaseStackKeys = Object.keys(META.database.stacks) as [string, ...string[]];
const extrasStackKeys = Object.keys(META.extras.stacks) as [string, ...string[]];

export const configSchema = z.object({
  name: z.string().default('my-app'),
  apps: z.array(
    z.object({
      name: z.string(),
      platform: z.enum(['web', 'api', 'mobile']),
      framework: z.string(),
      backend: z.enum(['builtin', ...apiStackKeys]).optional(),
    }),
  ),
  orm: z.enum(ormStackKeys).optional(),
  database: z.enum(databaseStackKeys).optional(),
  extras: z.array(z.enum(extrasStackKeys)).optional(),
});

export type Config = z.infer<typeof configSchema>;
