import { spinner } from '@clack/prompts';
import color from 'picocolors';
import { runCommand } from '@/lib/run-command';
import type { TemplateContext } from '@/types/ctx';

export interface InstallFailure {
  command: string;
  output: string;
}

interface PostGenerationResult {
  installFailure?: InstallFailure;
  gitFailure?: string;
}

async function installDependencies(ctx: TemplateContext, projectPath: string): Promise<InstallFailure | undefined> {
  const command = `${ctx.pm} install`;
  const s = spinner();
  s.start(`Installing dependencies with ${ctx.pm}...`);
  const result = await runCommand(command, projectPath);
  if (result.success) {
    s.stop(`Dependencies installed successfully!`);
    return undefined;
  }
  s.stop(color.red('Failed to install dependencies'), 1);
  return { command, output: result.output };
}

async function initializeGit(projectPath: string): Promise<string | undefined> {
  const s = spinner();
  s.start('Initializing git repository...');
  const result = await runCommand('git init', projectPath);
  if (result.success) {
    s.stop('Git repository initialized successfully!');
    return undefined;
  }
  s.stop(color.yellow(`⚠ Warning: Failed to initialize git: ${result.output}\nYou can manually run "git init" later.`));
  return result.output;
}

export async function runPostGeneration(ctx: TemplateContext, projectPath: string): Promise<PostGenerationResult> {
  const installFailure = ctx.pm && !ctx.skipInstall ? await installDependencies(ctx, projectPath) : undefined;
  const gitFailure = ctx.git ? await initializeGit(projectPath) : undefined;

  return { installFailure, gitFailure };
}
