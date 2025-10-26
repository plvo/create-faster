import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

/**
 * Binary file extensions that should never be processed as text
 */
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

/**
 * Check if a file path represents a binary file
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Ensure a directory exists, creating it recursively if needed
 */
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

/**
 * Write content to a file, creating parent directories if needed
 */
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

/**
 * Copy a binary file without processing
 */
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

/**
 * Read file content as text
 */
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

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Transform special filenames (_gitignore -> .gitignore)
 */
export function transformSpecialFilename(filename: string): string {
  // Handle underscore-prefixed files
  if (filename.startsWith('__')) {
    return `.${filename.slice(2)}`;
  }

  return filename;
}

/**
 * Remove .hbs extension from filename
 */
export function removeHbsExtension(filename: string): string {
  if (filename.endsWith('.hbs')) {
    return filename.slice(0, -4);
  }
  return filename;
}
