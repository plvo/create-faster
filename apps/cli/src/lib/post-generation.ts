import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { spinner } from '@clack/prompts';
import color from 'picocolors';
import { getErrorMessage } from '@/lib/error-utils';
import type { TemplateContext } from '@/types/ctx';

const execAsync = promisify(exec);

const FAILURE_OUTPUT_TAIL_LINES = 20;

export interface InstallFailure {
  command: string;
  output: string;
}

interface PostGenerationResult {
  installFailure?: InstallFailure;
  gitFailure?: string;
}

function tailLines(text: string, count: number): string {
  return text.trim().split('\n').slice(-count).join('\n');
}

function readFailureOutput(error: unknown): string {
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
  const output = [stderr, stdout].find((stream): stream is string => typeof stream === 'string' && !!stream.trim());
  return tailLines(output ?? getErrorMessage(error), FAILURE_OUTPUT_TAIL_LINES);
}

async function installDependencies(ctx: TemplateContext, projectPath: string): Promise<InstallFailure | undefined> {
  const command = `${ctx.pm} install`;
  const s = spinner();
  try {
    s.start(`Installing dependencies with ${ctx.pm}...`);
    await execAsync(command, { cwd: projectPath, timeout: 300000 });
    s.stop(`Dependencies installed successfully!`);
    return undefined;
  } catch (error) {
    s.stop(color.red('Failed to install dependencies'), 1);
    return { command, output: readFailureOutput(error) };
  }
}

async function initializeGit(projectPath: string): Promise<string | undefined> {
  const s = spinner();
  try {
    s.start('Initializing git repository...');
    await execAsync('git init', { cwd: projectPath, timeout: 10000 });
    s.stop('Git repository initialized successfully!');
    return undefined;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    s.stop(
      color.yellow(`⚠ Warning: Failed to initialize git: ${errorMessage}\nYou can manually run "git init" later.`),
    );
    return errorMessage;
  }
}

export async function runPostGeneration(ctx: TemplateContext, projectPath: string): Promise<PostGenerationResult> {
  const installFailure = ctx.pm && !ctx.skipInstall ? await installDependencies(ctx, projectPath) : undefined;
  const gitFailure = ctx.git ? await initializeGit(projectPath) : undefined;

  return { installFailure, gitFailure };
}
