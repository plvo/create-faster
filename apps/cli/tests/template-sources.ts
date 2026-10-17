import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES_DIR } from '@/lib/constants';

/** Every `.hbs` file under the templates directory, keyed by its path relative to it. */
export function templateSources(): Record<string, string> {
  const files = readdirSync(TEMPLATES_DIR, { recursive: true, encoding: 'utf-8' }).filter((file) =>
    file.endsWith('.hbs'),
  );
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(TEMPLATES_DIR, file), 'utf-8')]));
}
