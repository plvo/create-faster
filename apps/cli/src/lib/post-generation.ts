import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { spinner } from '@clack/prompts';
import color from 'picocolors';
import type { TemplateContext } from '@/types/ctx';

const execAsync = promisify(exec);

export async function runPostGeneration(ctx: TemplateContext, projectPath: string): Promise<void> {
  if (ctx.pm && !ctx.skipInstall) {
    const s = spinner();
    try {
      s.start(`Installing dependencies with ${ctx.pm}...`);

      const installCommand = `${ctx.pm} install`;

      await execAsync(installCommand, {
        cwd: projectPath,
        timeout: 300000,
      });
      s.stop(`Dependencies installed successfully!`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      s.stop(
        color.yellow(
          `⚠ Warning: Failed to install dependencies: ${errorMessage}\nYou can manually run the install command later.`,
        ),
      );
    }
  }

  if (ctx.git) {
    const s = spinner();
    try {
      s.start('Initializing git repository...');

      await execAsync('git init', { cwd: projectPath, timeout: 10000 });
      s.stop('Git repository initialized successfully!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      s.stop(
        color.yellow(`⚠ Warning: Failed to initialize git: ${errorMessage}\nYou can manually run "git init" later.`),
      );
    }
  }
}
