import path from 'node:path';
import { fileURLToPath } from 'node:url';
import color from 'picocolors';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(dirname, '..', '..', 'templates');

const emojis = ['🌱', '🚀', '💻', '🔥', '🔧', '🔨', '🔩', '🐱', '🤖'];

export const INTRO_MESSAGE = color.bgBlue(
  ` Creating a new project structure ${emojis[Math.floor(Math.random() * emojis.length)]} `,
);
