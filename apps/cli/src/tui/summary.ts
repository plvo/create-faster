import { note, outro } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import type { TemplateContext } from '@/types/ctx';

export function displayOutroCliCommand(ctx: TemplateContext, projectPath: string): void {
  let flagsCommand: string = `bunx create-faster ${ctx.projectName}`;

  for (const app of ctx.apps) {
    const modulesStr = app.modules.length > 0 ? `:${app.modules.join(',')}` : '';
    flagsCommand += ` --app ${app.appName}:${app.stackName}${modulesStr}`;
  }

  if (ctx.database) {
    flagsCommand += ` --database ${ctx.database}`;
  }

  if (ctx.orm) {
    flagsCommand += ` --orm ${ctx.orm}`;
  }

  if (ctx.git) {
    flagsCommand += ' --git';
  }

  if (ctx.pm) {
    flagsCommand += ` --pm ${ctx.pm}`;
  }

  if (ctx.extras && ctx.extras.length > 0) {
    flagsCommand += ` --extras ${ctx.extras.join(',')}`;
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

  lines.push(color.white(color.bold('#🏠 Structure:')));
  lines.push('');

  lines.push(`📦 ${color.bold(color.cyan(ctx.projectName))}/`);

  if (isTurborepo) {
    lines.push('├─ 🚀 apps/');
    ctx.apps.forEach((app, i) => {
      const stack = META.stacks[app.stackName];
      const modulesInfo = app.modules.length > 0 ? color.dim(` +${app.modules.length} modules`) : '';
      const isLast = i === ctx.apps.length - 1 && !ctx.orm;
      const prefix = isLast ? '│  └─' : '│  ├─';
      lines.push(`${prefix} ${app.appName}/ ${color.yellow(`(${stack?.label}${modulesInfo})`)}`);
    });
  } else {
    const app = ctx.apps[0];
    if (app) {
      const stack = META.stacks[app.stackName];
      const modulesInfo = app.modules.length > 0 ? color.dim(` +${app.modules.length} modules`) : '';
      lines.push(`├─ 📁 src/ ${color.yellow(`(${stack?.label}${modulesInfo})`)}`);
    }
  }

  if (isTurborepo && ctx.orm) {
    lines.push('├─ 📦 packages/');
    const ormMeta = ctx.orm ? META.orm.stacks[ctx.orm] : null;
    const dbMeta = ctx.database ? META.database.stacks[ctx.database] : null;
    const dbInfo = dbMeta ? ` + ${dbMeta.label}` : '';
    lines.push(`│  └─ db/ ${color.magenta(`(${ormMeta?.label}${dbInfo})`)}`);
  }

  const configs: string[] = [];
  if (isTurborepo) configs.push('Turborepo');
  if (ctx.git) configs.push('Git');
  if (ctx.extras?.includes('biome')) configs.push('Biome');
  if (ctx.extras?.includes('husky')) configs.push('Husky');

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
