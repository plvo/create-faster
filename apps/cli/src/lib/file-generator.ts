// ABOUTME: Orchestrates project file generation
// ABOUTME: Combines package.json generation and template processing

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { note, spinner } from '@clack/prompts';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import { collectEnvFiles, collectEnvGroups } from './env-generator';
import { pathExists } from './file-writer';
import { registerHandlebarsHelpers } from './handlebars';
import { generateAllPackageJsons } from './package-json-generator';
import { processTemplate } from './template-processor';

interface GenerationOptions {
  overwrite?: boolean;
}

interface GenerationResult {
  success: boolean;
  generated: string[];
  failed: Array<{ file: string; error: string }>;
  skipped: string[];
}

interface ProcessResult {
  success: boolean;
  destination: string;
  error?: string;
}

async function validateProjectDirectory(projectPath: string): Promise<void> {
  const exists = await pathExists(projectPath);
  if (exists) {
    throw new Error(
      `Directory '${projectPath}' already exists. Please choose a different project name or remove the existing directory.`,
    );
  }
}

export async function generateProjectFiles(
  templates: TemplateFile[],
  context: TemplateContext,
  options: GenerationOptions = {},
): Promise<GenerationResult> {
  const { overwrite = false } = options;
  const projectPath = join(process.cwd(), context.projectName);

  registerHandlebarsHelpers();

  if (!overwrite) {
    await validateProjectDirectory(projectPath);
  }

  const result: GenerationResult = {
    success: true,
    generated: [],
    failed: [],
    skipped: [],
  };

  const allResults: ProcessResult[] = [];

  // 1. Generate package.json files (programmatic)
  const packageJsons = generateAllPackageJsons(context);

  for (const { path, content } of packageJsons) {
    const fullPath = join(projectPath, path);

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, `${JSON.stringify(content, null, 2)}\n`);
      allResults.push({ success: true, destination: path });
    } catch (error) {
      allResults.push({
        success: false,
        destination: path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // 2. Generate .env.example files (programmatic)
  const envFiles = collectEnvFiles(context);

  for (const { destination, content } of envFiles) {
    const fullPath = join(projectPath, destination);

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
      allResults.push({ success: true, destination });
    } catch (error) {
      allResults.push({
        success: false,
        destination,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // 3. Process Handlebars templates
  const envGroups = collectEnvGroups(context);
  const enrichedContext = { ...context, envGroups };

  const s = spinner();
  const totalFiles = packageJsons.length + envFiles.length + templates.length;
  s.start(`Generating ${totalFiles} files...`);

  let processed = packageJsons.length + envFiles.length;
  for (const template of templates) {
    processed++;
    const progress = `[${processed}/${totalFiles}]`;
    s.message(`${progress} ${template.destination}`);

    const processResult = await processTemplate(template, enrichedContext, projectPath);
    allResults.push(processResult);
  }

  // 4. Compile results
  for (const r of allResults) {
    if (r.success && r.skipped) {
    } else if (r.success) {
      result.generated.push(r.destination);
    } else {
      result.failed.push({
        file: r.destination,
        error: r.error || 'Unknown error',
      });
      result.success = false;
    }
  }

  if (result.success) {
    s.stop(`✓ Generated ${result.generated.length} files successfully!`);
  } else {
    s.stop(`⚠ Generated ${result.generated.length} files, ${result.failed.length} failed`);
  }

  return result;
}

export function displayGenerationErrors(result: GenerationResult): void {
  const results: string[] = [];

  if (result.skipped.length > 0) {
    results.push(`⊘ Skipped ${result.skipped.length} files (already exist)`);
  }

  if (result.failed.length > 0) {
    results.push(`✗ Failed to generate ${result.failed.length} files:\n`);
    for (const failure of result.failed) {
      results.push(`  • ${failure.file}`);
      results.push(`    ${failure.error}`);
    }
  }

  note(results.join('\n'), 'Generation results');
}
