import { note, outro } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import { getMonoPackageName } from '@/lib/addon-utils';
import { collectFirstRunSteps } from '@/lib/first-run';
import { collectMonoPackages } from '@/lib/package-json-generator';
import { getPackageRunner } from '@/lib/package-manager';
import type { GitFailure } from '@/lib/post-generation';
import type { ProjectContext, TemplateContext } from '@/types/ctx';

export function displayOutroCliCommand(ctx: TemplateContext, projectPath: string): void {
  let flagsCommand: string = `${getPackageRunner(ctx)} create-faster ${ctx.projectName}`;

  if (ctx.blueprint) {
    flagsCommand += ` --blueprint ${ctx.blueprint}`;
    if (ctx.project.deployment) {
      flagsCommand += ` --deployment ${ctx.project.deployment}`;
    }
    if (ctx.project.linter) {
      flagsCommand += ` --linter ${ctx.project.linter}`;
    }
    for (const tooling of ctx.project.tooling) {
      flagsCommand += ` --tooling ${tooling}`;
    }
  } else {
    for (const app of ctx.apps) {
      const librariesStr = app.libraries.length > 0 ? `:${app.libraries.join(',')}` : '';
      flagsCommand += ` --app ${app.appName}:${app.stackName}${librariesStr}`;
    }

    for (const projectKey of Object.keys(ctx.project) as (keyof ProjectContext)[]) {
      if (Array.isArray(ctx.project[projectKey])) {
        for (const value of ctx.project[projectKey]) {
          flagsCommand += ` --${projectKey} ${value}`;
        }
      } else {
        flagsCommand += ` --${projectKey} ${ctx.project[projectKey]}`;
      }
    }
  }

  if (ctx.git) {
    flagsCommand += ' --git';
  }

  if (ctx.pm) {
    flagsCommand += ` --pm ${ctx.pm}`;
  }

  if (ctx.agentContext === false) {
    flagsCommand += ' --no-agent-context';
  }

  if (flagsCommand.length > 140) {
    flagsCommand = flagsCommand.replaceAll('--', '\\\n  --');
  }

  outro(`${color.bgCyan(color.black(`🚀 Project created successfully at ${projectPath}!`))}

${color.gray('🔥 You can recreate this project with the following command:')}

${color.bold(flagsCommand)}`);
}

export function displaySummaryNote(ctx: TemplateContext, gitFailure: GitFailure | undefined): void {
  const hasGitRepository = ctx.git && gitFailure === undefined;
  const texts = [...buildProjectStructure(ctx, hasGitRepository), ...buildStepsNote(ctx, hasGitRepository)];

  note(texts.join('\n'), color.bold('📂 Summary'));
}

function describeOrmPackage(ctx: TemplateContext, packageName: string): string {
  const { orm, database } = ctx.project;
  const ormAddon = orm ? META.project.orm.options[orm] : undefined;
  if (!orm || getMonoPackageName(ormAddon) !== packageName) return '';

  const dbLabel = database ? ` + ${META.project.database.options[database]?.label}` : '';
  return ` ${color.magenta(`(${ormAddon?.label}${dbLabel})`)}`;
}

function buildProjectStructure(ctx: TemplateContext, hasGitRepository: boolean): string[] {
  const lines: string[] = [];
  const isTurborepo = ctx.repo === 'turborepo';

  const packageNames = [...collectMonoPackages(ctx).keys()];

  lines.push(color.white(color.bold('#🏠 Structure:')));
  lines.push('');

  lines.push(`📦 ${color.bold(color.cyan(ctx.projectName))}/`);

  if (isTurborepo) {
    lines.push('├─ 🚀 apps/');
    ctx.apps.forEach((app, i) => {
      const stack = META.stacks[app.stackName];
      const librariesInfo = app.libraries.length > 0 ? color.dim(` +${app.libraries.length} libraries`) : '';
      const isLast = i === ctx.apps.length - 1 && packageNames.length === 0;
      const prefix = isLast ? '│  └─' : '│  ├─';
      lines.push(`${prefix} ${app.appName}/ ${color.yellow(`(${stack?.label}${librariesInfo})`)}`);
    });
  } else {
    const app = ctx.apps[0];
    if (app) {
      const stack = META.stacks[app.stackName];
      const librariesInfo = app.libraries.length > 0 ? color.dim(` +${app.libraries.length} libraries`) : '';
      lines.push(`├─ 📁 src/ ${color.yellow(`(${stack?.label}${librariesInfo})`)}`);
    }
  }

  if (packageNames.length > 0) {
    lines.push('├─ 📦 packages/');
    packageNames.forEach((name, i) => {
      const prefix = i === packageNames.length - 1 ? '│  └─' : '│  ├─';
      lines.push(`${prefix} ${name}/${describeOrmPackage(ctx, name)}`);
    });
  }

  const configs: string[] = [];
  if (isTurborepo) configs.push('Turborepo');
  if (hasGitRepository) configs.push('Git');
  if (ctx.project.linter) {
    configs.push(META.project.linter.options[ctx.project.linter]?.label ?? ctx.project.linter);
  }
  for (const name of ctx.project.tooling) {
    configs.push(META.project.tooling.options[name]?.label ?? name);
  }

  if (ctx.agentContext !== false) {
    configs.push('AGENTS.md');
  }

  if (configs.length > 0) {
    lines.push(`└─ ⚙️  ${color.dim(configs.join(', '))}`);
  }

  return lines;
}

function buildStepsNote(ctx: TemplateContext, hasGitRepository: boolean): string[] {
  const steps: string[] = [];

  steps.push('');
  steps.push(color.white(color.bold('#💡 Next steps:')));
  steps.push('');

  steps.push(`cd ${ctx.projectName}`);
  steps.push('');
  for (const { description, commands } of collectFirstRunSteps(ctx)) {
    steps.push(`# ${description}:`);
    steps.push(...commands);
    steps.push('');
  }
  steps.push('# Development:');
  steps.push(`${ctx.pm ?? 'npm'} run dev        # Start development server`);
  steps.push('');
  steps.push('# Build:');
  steps.push(`${ctx.pm ?? 'npm'} run build      # Build for production`);

  if (hasGitRepository) {
    steps.push('');
    steps.push('# Git:');
    steps.push('git remote add origin <your-repo-url>');
    steps.push('git push -u origin main');
  } else if (ctx.git) {
    steps.push('');
    steps.push('# git init failed, run it manually:');
    steps.push('git init');
  }

  return steps;
}
