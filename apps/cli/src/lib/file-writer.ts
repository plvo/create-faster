import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

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

export function transformSpecialFilename(filename: string): string {
  // Triple underscore escapes to double underscore (for files like __root.tsx)
  if (filename.startsWith('___')) {
    return `__${filename.slice(3)}`;
  }

  // Double underscore becomes dot (for dotfiles like .gitignore)
  if (filename.startsWith('__')) {
    return `.${filename.slice(2)}`;
  }

  return filename;
}

export function removeHbsExtension(filename: string): string {
  if (filename.endsWith('.hbs')) {
    return filename.slice(0, -4);
  }
  return filename;
}
