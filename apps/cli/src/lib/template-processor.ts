import { basename, join } from 'node:path';
import type { ProcessResult, TemplateContext, TemplateFile } from '@/types/ctx';
import { getErrorMessage } from './error-utils';
import { copyBinaryFile, isBinaryFile, readFileContent, transformFilename, writeFileContent } from './file-writer';
import { removeFrontmatter } from './frontmatter';
import { renderTemplate } from './handlebars';

export async function processTemplate(
  template: TemplateFile,
  context: TemplateContext,
  projectPath: string,
): Promise<ProcessResult> {
  const { source, destination } = template;

  try {
    const filename = basename(destination);
    const transformedFilename = transformFilename(filename);
    const finalDestination = join(projectPath, destination.replace(filename, transformedFilename));

    const isHbsTemplate = source.endsWith('.hbs');
    const isBinary = isBinaryFile(source);

    if (isBinary && !isHbsTemplate) {
      await copyBinaryFile(source, finalDestination);
      return { success: true, destination: finalDestination };
    }

    let content = await readFileContent(source);

    if (isHbsTemplate) {
      content = removeFrontmatter(content);
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
      if (!rendered.trim()) {
        return { success: true, destination: finalDestination, skipped: true, reason: 'empty content' };
      }
      await writeFileContent(finalDestination, rendered);
      return { success: true, destination: finalDestination };
    }

    await writeFileContent(finalDestination, content);
    return { success: true, destination: finalDestination };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    return {
      success: false,
      destination,
      error: `Failed to process ${source}: ${errorMessage}`,
    };
  }
}
