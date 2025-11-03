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
import { renderTemplate } from './handlebars-utils';
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
    // Determine final destination path with transformations
    const filename = basename(destination);
    const transformedFilename = transformSpecialFilename(removeHbsExtension(filename));
    const finalDestination = join(projectPath, destination.replace(filename, transformedFilename));

    const isHbsTemplate = source.endsWith('.hbs');
    const isBinary = isBinaryFile(source);

    // Binary file without .hbs extension: direct copy
    if (isBinary && !isHbsTemplate) {
      await copyBinaryFile(source, finalDestination);
      return { success: true, destination: finalDestination };
    }

    // Read source content
    const content = await readFileContent(source);

    // Check for magic comments in .hbs templates
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
      // Enrich context with current app info
      let enrichedContext: TemplateContext | (TemplateContext & Record<string, unknown>) = context;

      const pathParts = destination.split('/');

      if (pathParts[0] === 'apps' && pathParts[1]) {
        // Turborepo mode: apps/web/... → extract "web" or "web-server"
        const appName = pathParts[1];

        // Check if it's a server app (ends with -server)
        const currentApp = context.apps.find((app) => app.appName === appName);

        // If not found and ends with -server, find parent app
        if (!currentApp && appName.endsWith('-server')) {
          const parentAppName = appName.replace('-server', '');
          const parentApp = context.apps.find((app) => app.appName === parentAppName);

          if (parentApp?.metaServer) {
            // Create a virtual server app context
            enrichedContext = {
              ...context,
              appName,
              metaServer: parentApp.metaServer,
            };
          }
        } else if (currentApp) {
          enrichedContext = { ...context, ...currentApp };
        }
      } else if (context.repo === 'single' && context.apps.length > 0) {
        // Single repo mode: use first (and only) app
        enrichedContext = { ...context, ...context.apps[0] };
      }

      const rendered = renderTemplate(content, enrichedContext);
      await writeFileContent(finalDestination, rendered);
      return { success: true, destination: finalDestination };
    }

    // Regular text file: copy as-is
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
