import color from 'picocolors';

export type ProgressStep = {
  label: string;
  status: 'pending' | 'active' | 'done';
};

export class Progress {
  private steps: ProgressStep[];
  private current = 0;

  constructor(labels: string[]) {
    this.steps = labels.map((label, i) => ({
      label,
      status: i === 0 ? 'active' : 'pending',
    }));
  }

  render(): string {
    const icons = this.steps
      .map((s) => {
        if (s.status === 'done') return color.green('●');
        if (s.status === 'active') return color.cyan('◆');
        return color.dim('○');
      })
      .join(' ');

    const percent = Math.round((this.current / this.steps.length) * 100);
    const counter = color.blueBright(`${this.current}/${this.steps.length}`);

    return `${color.blueBright('[ ')}${icons}${color.blueBright(' ]')} ${counter} ${color.dim(`${percent}%`)}`;
  }

  message(text: string): string {
    return `${text} ${this.render()}`;
  }

  next() {
    if (this.current < this.steps.length) {
      this.steps[this.current]!.status = 'done';
      this.current++;
      if (this.current < this.steps.length) {
        this.steps[this.current]!.status = 'active';
      }
    }
  }
}
