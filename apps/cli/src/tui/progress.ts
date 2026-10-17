import color from 'picocolors';

/**
 * Numbers the prompts of a flow. `expectedPrompts` lists the ids of the prompts the answers so far say will be
 * asked, so the total follows the flow: a prompt that stops being expected shrinks it, one that appears grows it.
 */
export class Progress {
  private readonly asked: string[] = [];

  constructor(private readonly expectedPrompts: () => string[]) {}

  hasAsked(promptId: string): boolean {
    return this.asked.includes(promptId);
  }

  render(): string {
    const upcoming = this.expectedPrompts().filter((id) => !this.asked.includes(id));
    const total = this.asked.length + upcoming.length;
    const position = this.asked.length;

    const icons = Array.from({ length: total }, (_, i) => {
      if (i < position - 1) return color.green('●');
      if (i === position - 1) return color.cyan('◆');
      return color.dim('○');
    }).join('');

    const percent = Math.round(((position - 1) / total) * 100);
    const counter = color.blueBright(`${position}/${total}`);

    return `${color.blueBright('[ ')}${icons}${color.blueBright(' ]')} ${counter} ${color.dim(`${percent}%`)}`;
  }

  message(promptId: string, text: string): string {
    if (!this.asked.includes(promptId)) this.asked.push(promptId);
    return `${text} ${this.render()}`;
  }
}
