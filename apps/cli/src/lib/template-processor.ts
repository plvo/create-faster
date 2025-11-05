import { basename, join } from 'node:path';
import type { TemplateContext, TemplateFile } from '@/types/ctx';
import {
  copyBinaryFile,
  isBinaryFile,
  readFileContent,
  removeHbsExtension,
  transformSpecialFilename,
  writeFileContent,
} from './file-writer';
import { renderTemplate } from './handlebars';
import { extractFirstLine, formatMagicComments, parseMagicComments, shouldSkipTemplate } from './magic-comments';

interface ProcessResult {
  success: boolean;
  destination: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * Process a single template file
 * - Binary files without .hbs: direct copy
 * - Files with .hbs: Handlebars rendering
 * - Other files: copy as text
 */
export async function processTemplate(
  template: TemplateFile,
  context: TemplateContext,
  projectPath: string,
): Promise<ProcessResult> {
  const { source, destination } = template;

  try {
    const filename = basename(destination);
    const transformedFilename = transformSpecialFilename(removeHbsExtension(filename));
    const finalDestination = join(projectPath, destination.replace(filename, transformedFilename));

    const isHbsTemplate = source.endsWith('.hbs');
    const isBinary = isBinaryFile(source);

    if (isBinary && !isHbsTemplate) {
      await copyBinaryFile(source, finalDestination);
      return { success: true, destination: finalDestination };
    }

    const content = await readFileContent(source);

    if (isHbsTemplate) {
      const firstLine = extractFirstLine(content);
      const magicComments = parseMagicComments(firstLine);

      if (shouldSkipTemplate(magicComments, context)) {
        return {
          success: true,
          destination: finalDestination,
          skipped: true,
          reason: `Magic comment: ${formatMagicComments(magicComments)}`,
        };
      }
    }

    if (isHbsTemplate) {
      let enrichedContext: TemplateContext | (TemplateContext & Record<string, unknown>) = context;

      const pathParts = destination.split('/');

      if (pathParts[0] === 'apps' && pathParts[1]) {
        const appName = pathParts[1];
        const currentApp = context.apps.find((app) => app.appName === appName);

        if (currentApp) {
          enrichedContext = { ...context, ...currentApp };
        }
      } else if (context.repo === 'single' && context.apps.length > 0) {
        enrichedContext = { ...context, ...context.apps[0] };
      }

      const rendered = renderTemplate(content, enrichedContext);
      await writeFileContent(finalDestination, rendered);
      return { success: true, destination: finalDestination };
    }

    await writeFileContent(finalDestination, content);
    return { success: true, destination: finalDestination };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      destination,
      error: `Failed to process ${source}: ${errorMessage}`,
    };
  }
}
