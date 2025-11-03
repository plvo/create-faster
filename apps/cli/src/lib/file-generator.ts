import { join } from 'node:path';
import { spinner } from '@clack/prompts';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import { pathExists } from './file-writer';
import { registerHandlebarsHelpers } from './handlebars-utils';
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

/**
 * Validate that the project directory doesn't already exist
 */
async function validateProjectDirectory(projectPath: string): Promise<void> {
  const exists = await pathExists(projectPath);
  if (exists) {
    throw new Error(
      `Directory '${projectPath}' already exists. Please choose a different project name or remove the existing directory.`,
    );
  }
}

/**
 * Generate all project files from templates
 */
export async function generateProjectFiles(
  templates: TemplateFile[],
  context: TemplateContext,
  options: GenerationOptions = {},
): Promise<GenerationResult> {
  const { overwrite = false } = options;
  const projectPath = join(process.cwd(), context.projectName);

  // Register Handlebars helpers once before processing
  registerHandlebarsHelpers();

  // Validate project directory
  if (!overwrite) {
    await validateProjectDirectory(projectPath);
  }

  const result: GenerationResult = {
    success: true,
    generated: [],
    failed: [],
    skipped: [],
  };

  // Create spinner for progress
  const s = spinner();
  s.start(`Generating ${templates.length} files...`);

  let processed = 0;
  for (const template of templates) {
    processed++;
    const progress = `[${processed}/${templates.length}]`;
    s.message(`${progress} ${template.destination}...`);

    const processResult = await processTemplate(template, context, projectPath);

    if (processResult.success) {
      result.generated.push(processResult.destination);
    } else {
      result.failed.push({
        file: template.destination,
        error: processResult.error || 'Unknown error',
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

/**
 * Display generation results with detailed error information
 */
export function displayGenerationResults(result: GenerationResult): void {
  console.log('\n=== Generation Results ===\n');

  if (result.generated.length > 0) {
    console.log(`✓ Successfully generated ${result.generated.length} files`);
  }

  if (result.skipped.length > 0) {
    console.log(`⊘ Skipped ${result.skipped.length} files (already exist)`);
  }

  if (result.failed.length > 0) {
    console.log(`\n✗ Failed to generate ${result.failed.length} files:\n`);
    for (const failure of result.failed) {
      console.log(`  • ${failure.file}`);
      console.log(`    ${failure.error}`);
    }
  }
}
