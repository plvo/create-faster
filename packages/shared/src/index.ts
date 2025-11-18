import color from 'picocolors';
import packageJson from '../../../apps/cli/package.json' with { type: 'json' };

export const CLI_VERSION = packageJson.version;

export const ASCII = color.blueBright(`
                        __             ____           __           
  _____________  ____ _/ /____        / __/___ ______/ /____  _____
 / ___/ ___/ _ \\/ __ \`/ __/ _ \\______/ /_/ __ \`/ ___/ __/ _ \\/ ___/
/ /__/ /  /  __/ /_/ / /_/  __/_____/ __/ /_/ (__  ) /_/  __/ /    
\\___/_/   \\___/\\__,_/\\__/\\___/     /_/  \\__,_/____/\\__/\\___/_/   ${color.cyan(CLI_VERSION)}
`);
