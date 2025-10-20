import { META } from '@/__meta__';
import type { Config } from './schema';

interface ValidationError {
  field: string;
  message: string;
}

export function validateCompatibility(config: Partial<Config>): ValidationError[] {
  const errors: ValidationError[] = [];

  // ORM requires database
  if (config.orm) {
    const ormMeta = META.orm.stacks[config.orm];
    if (ormMeta?.requires?.includes('database') && !config.database) {
      errors.push({
        field: 'database',
        message: `${ormMeta.label} requires a database to be selected`,
      });
    }
  }

  // Database requires ORM
  if (config.database) {
    const dbMeta = META.database.stacks[config.database];
    if (dbMeta?.requires?.includes('orm') && !config.orm) {
      errors.push({
        field: 'orm',
        message: `${dbMeta.label} requires an ORM to be selected`,
      });
    }
  }

  return errors;
}
