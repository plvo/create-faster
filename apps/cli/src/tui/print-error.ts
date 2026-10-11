import color from 'picocolors';

export function printError(title: string, ...messages: string[]): void {
  console.error(`\n${color.red('✖')} ${color.bold(color.red(title))}`);
  for (const msg of messages) {
    console.error(color.gray(msg));
  }
  console.error('');
}
