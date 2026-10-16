import { spinner } from '@clack/prompts';
import color from 'picocolors';
import { collectPostGenerateSteps, type ResolvedPostGenerateStep } from '@/lib/post-generate';
import { runCommand } from '@/lib/run-command';
import type { TemplateContext } from '@/types/ctx';

export interface InstallFailure {
  command: string;
  output: string;
}

export interface GitFailure {
  output: string;
}

/** A `postGenerate` step that did not complete: skipped with the install, or failed (`output` is then the tail of its output). */
export interface PendingPostGenerateStep extends ResolvedPostGenerateStep {
  output?: string;
}

interface PostGenerationResult {
  installFailure?: InstallFailure;
  gitFailure?: GitFailure;
  pendingPostGenerate: PendingPostGenerateStep[];
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

async function runPostGenerateSteps(
  steps: ResolvedPostGenerateStep[],
  projectPath: string,
): Promise<PendingPostGenerateStep[]> {
  const pending: PendingPostGenerateStep[] = [];
  for (const step of steps) {
    const s = spinner();
    s.start(`${step.description}...`);
    const result = await runCommand(step.command, projectPath);
    if (result.success) {
      s.stop(`${step.description}: done!`);
      continue;
    }
    s.stop(
      color.yellow(
        `⚠ Warning: "${step.description}" failed: ${result.output}\nYou can manually run "${step.command}" later.`,
      ),
    );
    pending.push({ ...step, output: result.output });
  }
  return pending;
}

async function initializeGit(projectPath: string): Promise<GitFailure | undefined> {
  const s = spinner();
  s.start('Initializing git repository...');
  const result = await runCommand('git init', projectPath);
  if (result.success) {
    s.stop('Git repository initialized successfully!');
    return undefined;
  }
  s.stop(
    color.yellow(
      `⚠ Warning: Failed to initialize git: ${result.output}\nRun "git init" in the project, then install the dependencies (again if already installed) so install scripts find the repository.`,
    ),
  );
  return { output: result.output };
}

export async function runPostGeneration(ctx: TemplateContext, projectPath: string): Promise<PostGenerationResult> {
  const steps = collectPostGenerateSteps(ctx);
  const installs = ctx.pm && !ctx.skipInstall;
  const gitFailure = ctx.git ? await initializeGit(projectPath) : undefined;
  const installFailure = installs ? await installDependencies(ctx, projectPath) : undefined;
  const pendingPostGenerate = installs && !installFailure ? await runPostGenerateSteps(steps, projectPath) : steps;

  return { installFailure, gitFailure, pendingPostGenerate };
}
