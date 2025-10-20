import { z } from 'zod';
import { META } from '@/__meta__';

const frameworkStackKeys = Object.keys(META.framework.stacks) as [string, ...string[]];
const backendStackKeys = Object.keys(META.backend.stacks) as [string, ...string[]];
const ormStackKeys = Object.keys(META.orm.stacks) as [string, ...string[]];
const databaseStackKeys = Object.keys(META.database.stacks) as [string, ...string[]];
const extrasStackKeys = Object.keys(META.extras.stacks) as [string, ...string[]];

export const configSchema = z.object({
  name: z.string().default('my-app').optional(),
  framework: z
    .object({
      stack: z.enum(frameworkStackKeys),
      appName: z.string().default('web'),
    })
    .optional(),
  backend: z
    .object({
      stack: z.enum(backendStackKeys),
      appName: z.string().default('api'),
    })
    .optional(),
  orm: z.enum(ormStackKeys).optional(),
  database: z.enum(databaseStackKeys).optional(),
  extras: z.array(z.enum(extrasStackKeys)).optional(),
});

export type Config = z.infer<typeof configSchema>;
