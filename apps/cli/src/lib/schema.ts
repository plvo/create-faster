import { z } from 'zod';
import { META } from '@/__meta__';

export const configSchema = z.object({
  name: z.string().default('my-app').optional(),
  repo: z.enum(Object.keys(META.repo)).default('single').optional(),
  framework: z.enum(Object.keys(META.framework)).optional(),
  backend: z.enum(Object.keys(META.backend)).optional(),
  orm: z.enum(Object.keys(META.orm)).optional(),
  database: z.enum(Object.keys(META.database)).optional(),
  extras: z.array(z.enum(Object.keys(META.extras))).optional(),
});

export type Config = z.infer<typeof configSchema>;
