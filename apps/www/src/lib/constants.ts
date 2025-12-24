import packageJson from '../../../cli/package.json' with { type: 'json' };

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://create.plvo.dev';
export const SITE_NAME = 'Create Faster';
export const SITE_TITLE = 'Create Faster - Modern CLI scaffolding tool for production-ready projects';
export const SITE_DESCRIPTION =
  'Quickly scaffold production-ready full-stack projects with Next.js, Expo, Hono, Prisma, Drizzle, and more. Interactive CLI with multi-app support and modular architecture.';

export const CLI_VERSION = packageJson.version;

export const ASCII_BASE = `                        __             ____           __           
  _____________  ____ _/ /____        / __/___ ______/ /____  _____
 / ___/ ___/ _ \\/ __ \`/ __/ _ \\______/ /_/ __ \`/ ___/ __/ _ \\/ ___/
/ /__/ /  /  __/ /_/ / /_/  __/_____/ __/ /_/ (__  ) /_/  __/ /    
\\___/_/   \\___/\\__,_/\\__/\\___/     /_/  \\__,_/____/\\__/\\___/_/   `;
