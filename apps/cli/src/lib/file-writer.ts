import { constants, existsSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { globSync } from 'fast-glob';

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
]);

export function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
    throw error;
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  try {
    const dir = dirname(filePath);
    await ensureDirectory(dir);
    await writeFile(filePath, content, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export async function copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    const dir = dirname(destPath);
    await ensureDirectory(dir);
    await copyFile(sourcePath, destPath);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to copy binary file ${sourcePath} to ${destPath}: ${error.message}`);
    }
    throw error;
  }
}

export async function readFileContent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Transforms filenames to their corresponding filenames
 * @example
 * transformFilename('page.tsx.hbs') -> 'page.tsx'
 * transformFilename('__gitignore.hbs') -> '.gitignore'
 * transformFilename('___root.tsx.hbs') -> '__root.tsx'
 */
export function transformFilename(filename: string): string {
  const result = filename.replace(/\.hbs$/, '');

  if (result.startsWith('___')) {
    return `__${result.slice(3)}`;
  }

  // Double underscore becomes dot (for dotfiles like .gitignore)
  if (result.startsWith('__')) {
    return `.${result.slice(2)}`;
  }

  return result;
}

/**
 *  Scans a directory for files
 * @example
 * scanDirectory('apps/my-app/src') -> ['page.tsx', 'api.ts', 'api/route.ts']
 */
export function scanDirectory(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return globSync('**/*', { cwd: dir, onlyFiles: true, dot: true });
  } catch {
    return [];
  }
}
