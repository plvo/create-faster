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
    const ormMeta = META.orm[config.orm];
    if (ormMeta && 'requires' in ormMeta && ormMeta.requires?.includes('database') && !config.database) {
      errors.push({
        field: 'database',
        message: `${ormMeta.label} requires a database to be selected`,
      });
    }
  }

  // Database requires ORM
  if (config.database) {
    const dbMeta = META.database[config.database];
    if (dbMeta && 'requires' in dbMeta && dbMeta.requires?.includes('orm') && !config.orm) {
      errors.push({
        field: 'orm',
        message: `${dbMeta.label} requires an ORM to be selected`,
      });
    }
  }

  // Check incompatibilities
  if (config.orm) {
    const ormMeta = META.orm[config.orm];
    if (ormMeta && 'incompatible' in ormMeta && ormMeta.incompatible) {
      for (const incomp of ormMeta.incompatible) {
        if (config[incomp as keyof Config]) {
          errors.push({
            field: config.orm,
            message: `${ormMeta.label} is incompatible with ${incomp}`,
          });
        }
      }
    }
  }

  return errors;
}

export function getCompatibleOptions<T extends keyof typeof META>(
  category: T,
  currentConfig: Partial<Config>,
): Array<keyof (typeof META)[T]> {
  const allOptions = Object.keys(META[category]) as Array<keyof (typeof META)[T]>;

  return allOptions.filter((option) => {
    const meta = META[category][option];

    // Check if this option has incompatible items
    if (meta && 'incompatible' in meta && meta.incompatible) {
      for (const incomp of meta.incompatible) {
        if (currentConfig[incomp as keyof Config]) {
          return false;
        }
      }
    }

    return true;
  });
}
