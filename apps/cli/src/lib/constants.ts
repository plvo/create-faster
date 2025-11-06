import path from 'node:path';
import { fileURLToPath } from 'node:url';
import color from 'picocolors';
import packageJson from '../../package.json' with { type: 'json' };

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.resolve(dirname, '..', '..', 'templates');

const VERSION = packageJson.version;

export const INTRO_ASCII = color.blueBright(`
                        __             ____           __           
  _____________  ____ _/ /____        / __/___ ______/ /____  _____
 / ___/ ___/ _ \\/ __ \`/ __/ _ \\______/ /_/ __ \`/ ___/ __/ _ \\/ ___/
/ /__/ /  /  __/ /_/ / /_/  __/_____/ __/ /_/ (__  ) /_/  __/ /    
\\___/_/   \\___/\\__,_/\\__/\\___/     /_/  \\__,_/____/\\__/\\___/_/   ${color.cyan(VERSION)}
`);

const emojis = ['🌱', '🚀', '💻', '🔥', '🔧', '🔨', '🔩', '🐱', '🤖'];

export const INTRO_MESSAGE = color.bgBlue(
  ` Creating a new project structure ${emojis[Math.floor(Math.random() * emojis.length)]} `,
);
