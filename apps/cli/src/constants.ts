import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  process.env.NODE_ENV === 'development' ? '..' : '',
  'templates',
);
