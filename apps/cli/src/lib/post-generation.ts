import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { note, outro } from '@clack/prompts';
import type { TemplateContext } from '@/types';

const execAsync = promisify(exec);

/**
 * Package manager types
 */
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

/**
 * Detect available package manager
 */
export async function detectPackageManager(): Promise<PackageManager> {
  const managers: PackageManager[] = ['bun', 'pnpm', 'npm', 'yarn'];

  for (const manager of managers) {
    try {
      await execAsync(`${manager} --version`, { timeout: 3000 });
      return manager;
    } catch {
      // Manager not available, try next
    }
  }

  // Fallback to npm (should always be available with Node.js)
  return 'npm';
}

/**
 * Install dependencies using the specified package manager
 */
export async function installDependencies(
  projectPath: string,
  packageManager?: PackageManager,
): Promise<{ success: boolean; error?: string }> {
  try {
    const pm = packageManager || (await detectPackageManager());

    console.log(`\nInstalling dependencies with ${pm}...`);

    const installCommand = pm === 'npm' ? 'npm install' : `${pm} install`;

    await execAsync(installCommand, {
      cwd: projectPath,
      timeout: 300000, // 5 minutes timeout
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to install dependencies: ${errorMessage}`,
    };
  }
}

/**
 * Initialize git repository
 */
export async function initializeGit(projectPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('\nInitializing git repository...');

    // Initialize git
    await execAsync('git init', { cwd: projectPath, timeout: 10000 });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to initialize git: ${errorMessage}`,
    };
  }
}

/**
 * Display success message with next steps
 */
export function displaySuccessMessage(context: TemplateContext, projectPath: string): void {
  const { projectName, apps, repo, git } = context;

  // Build next steps message
  const steps: string[] = [];

  steps.push(`cd ${projectName}`);

  if (repo === 'turborepo') {
    steps.push('# Development:');
    steps.push('bun run dev        # Start all apps in development mode');
    steps.push('');
    steps.push('# Build:');
    steps.push('bun run build      # Build all apps');
  } else {
    const app = apps[0];
    if (app) {
      steps.push('# Development:');
      steps.push('bun run dev        # Start development server');
      steps.push('');
      steps.push('# Build:');
      steps.push('bun run build      # Build for production');
    }
  }

  if (git) {
    steps.push('');
    steps.push('# Git:');
    steps.push('git remote add origin <your-repo-url>');
    steps.push('git push -u origin main');
  }

  note(steps.join('\n'), 'Next steps');

  // Display apps summary
  if (apps.length > 1) {
    const appsSummary = apps
      .map((app) => {
        if (app.metaApp) {
          const server = app.metaServer ? ` + ${app.metaServer.name}` : '';
          return `  • ${app.appName} (${app.metaApp.name}${server})`;
        }
        return `  • ${app.appName} (${app.metaServer?.name})`;
      })
      .join('\n');

    note(appsSummary, 'Created apps');
  }

  outro(`✨ Project created successfully at ${projectPath}!`);
}

/**
 * Run all post-generation tasks
 */
export async function runPostGeneration(
  context: TemplateContext,
  projectPath: string,
  options: {
    install?: boolean;
    packageManager?: PackageManager;
  } = {},
): Promise<void> {
  const { install = true, packageManager } = options;

  // Install dependencies
  if (install) {
    const installResult = await installDependencies(projectPath, packageManager);
    if (!installResult.success) {
      console.warn(`⚠ Warning: ${installResult.error}`);
      console.warn('You can manually run the install command later.');
    }
  }

  // Initialize git if requested
  if (context.git) {
    const gitResult = await initializeGit(projectPath);
    if (!gitResult.success) {
      console.warn(`⚠ Warning: ${gitResult.error}`);
      console.warn('You can manually run "git init" later.');
    }
  }

  // Display success message
  displaySuccessMessage(context, projectPath);
}
