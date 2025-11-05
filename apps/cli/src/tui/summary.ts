import { note } from '@clack/prompts';
import color from 'picocolors';
import { META } from '@/__meta__';
import type { TemplateContext } from '@/types/ctx';

export function displayStepsNote(ctx: TemplateContext): void {
  const steps: string[] = [];

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

  note(steps.join('\n'), color.bold('💡 Next steps'));
}

export function displayProjectStructure(ctx: TemplateContext): void {
  const lines: string[] = [];
  const isTurborepo = ctx.repo === 'turborepo';

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

  note(lines.join('\n'), color.bold('📂 Structure Summary'));
}
