// ABOUTME: Summary display and CLI command generation
// ABOUTME: Shows project structure and recreate command with unified addons

import { note, outro } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import type { TemplateContext } from '@/types/ctx';

export function displayOutroCliCommand(ctx: TemplateContext, projectPath: string): void {
  let flagsCommand: string = `bunx create-faster ${ctx.projectName}`;

  for (const app of ctx.apps) {
    const addonsStr = app.addons.length > 0 ? `:${app.addons.join(',')}` : '';
    flagsCommand += ` --app ${app.appName}:${app.stackName}${addonsStr}`;
  }

  for (const addonName of ctx.globalAddons) {
    flagsCommand += ` --addon ${addonName}`;
  }

  if (ctx.git) {
    flagsCommand += ' --git';
  }

  if (ctx.pm) {
    flagsCommand += ` --pm ${ctx.pm}`;
  }

  if (flagsCommand.length > 140) {
    flagsCommand = flagsCommand.replaceAll('--', '\\\n  --');
  }

  outro(`${color.bgCyan(color.black(`🚀 Project created successfully at ${projectPath}!`))}

${color.gray('🔥 You can recreate this project with the following command:')}

${color.bold(flagsCommand)}`);
}

export function displaySummaryNote(ctx: TemplateContext): void {
  const texts = [...buildProjectStructure(ctx), ...buildStepsNote(ctx)];

  note(texts.join('\n'), color.bold('📂 Summary'));
}

function buildProjectStructure(ctx: TemplateContext): string[] {
  const lines: string[] = [];
  const isTurborepo = ctx.repo === 'turborepo';

  const hasOrm = ctx.globalAddons.some((name) => META.addons[name]?.type === 'orm');
  const hasDb = ctx.globalAddons.some((name) => META.addons[name]?.type === 'database');

  lines.push(color.white(color.bold('#🏠 Structure:')));
  lines.push('');

  lines.push(`📦 ${color.bold(color.cyan(ctx.projectName))}/`);

  if (isTurborepo) {
    lines.push('├─ 🚀 apps/');
    ctx.apps.forEach((app, i) => {
      const stack = META.stacks[app.stackName];
      const addonsInfo = app.addons.length > 0 ? color.dim(` +${app.addons.length} modules`) : '';
      const isLast = i === ctx.apps.length - 1 && !hasOrm;
      const prefix = isLast ? '│  └─' : '│  ├─';
      lines.push(`${prefix} ${app.appName}/ ${color.yellow(`(${stack?.label}${addonsInfo})`)}`);
    });
  } else {
    const app = ctx.apps[0];
    if (app) {
      const stack = META.stacks[app.stackName];
      const addonsInfo = app.addons.length > 0 ? color.dim(` +${app.addons.length} modules`) : '';
      lines.push(`├─ 📁 src/ ${color.yellow(`(${stack?.label}${addonsInfo})`)}`);
    }
  }

  if (isTurborepo && hasOrm) {
    lines.push('├─ 📦 packages/');
    const ormAddon = ctx.globalAddons.find((name) => META.addons[name]?.type === 'orm');
    const dbAddon = ctx.globalAddons.find((name) => META.addons[name]?.type === 'database');
    const ormLabel = ormAddon ? META.addons[ormAddon]?.label : '';
    const dbLabel = dbAddon ? ` + ${META.addons[dbAddon]?.label}` : '';
    lines.push(`│  └─ db/ ${color.magenta(`(${ormLabel}${dbLabel})`)}`);
  }

  const configs: string[] = [];
  if (isTurborepo) configs.push('Turborepo');
  if (ctx.git) configs.push('Git');
  if (ctx.globalAddons.includes('biome')) configs.push('Biome');
  if (ctx.globalAddons.includes('husky')) configs.push('Husky');

  if (configs.length > 0) {
    lines.push(`└─ ⚙️  ${color.dim(configs.join(', '))}`);
  }

  return lines;
}

function buildStepsNote(ctx: TemplateContext): string[] {
  const steps: string[] = [];

  steps.push('');
  steps.push(color.white(color.bold('#💡 Next steps:')));
  steps.push('');

  steps.push(`cd ${ctx.projectName}`);
  steps.push('');
  steps.push('# Development:');
  steps.push(`${ctx.pm ?? 'npm'} run dev        # Start development server`);
  steps.push('');
  steps.push('# Build:');
  steps.push(`${ctx.pm ?? 'npm'} run build      # Build for production`);

  if (ctx.git) {
    steps.push('');
    steps.push('# Git:');
    steps.push('git remote add origin <your-repo-url>');
    steps.push('git push -u origin main');
  }

  return steps;
}
