import { basename, resolve } from 'node:path';
import type { TemplateContext } from '@/types/ctx';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

type ProjectLocation = Pick<TemplateContext, 'projectName' | 'projectDir'>;

export function projectNameOf(projectDir: string): string {
  return basename(projectDir);
}

export function validateProjectName(projectName: string): string | undefined {
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    return `Project name "${projectName}" must start with a lowercase letter or digit and contain only lowercase letters, digits, "-", "_" and "."`;
  }
}

export function getProjectDir(ctx: ProjectLocation): string {
  return ctx.projectDir ?? ctx.projectName;
}

export function getProjectPath(ctx: ProjectLocation): string {
  return resolve(process.cwd(), getProjectDir(ctx));
}
