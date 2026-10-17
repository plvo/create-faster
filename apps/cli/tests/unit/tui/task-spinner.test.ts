import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { taskSpinner } from '@/tui/task-spinner';

const SPINNER_FRAMES = /[◒◐◓◑]/;
const ERASE_LINE = '\x1b[999D';

describe('taskSpinner', () => {
  let written: string;
  let wasTerminal: boolean | undefined;

  function setTerminal(isTerminal: boolean) {
    Object.defineProperty(process.stdout, 'isTTY', { value: isTerminal, configurable: true });
  }

  beforeEach(() => {
    written = '';
    wasTerminal = process.stdout.isTTY;
    spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written += chunk.toString();
      return true;
    });
  });

  afterEach(() => {
    mock.restore();
    setTerminal(Boolean(wasTerminal));
  });

  test('prints the start and the end of a task as plain lines when stdout is not a terminal', async () => {
    setTerminal(false);

    const task = taskSpinner();
    task.start('Installing dependencies with npm...');
    await Bun.sleep(300);
    task.message('[3/9] package.json');
    task.stop('Dependencies installed successfully!');

    expect(written).toContain('Installing dependencies with npm...');
    expect(written).toContain('Dependencies installed successfully!');
    expect(written).not.toContain('[3/9]');
    expect(written).not.toMatch(SPINNER_FRAMES);
    expect(written).not.toContain(ERASE_LINE);
  });

  test.each([1, 2])('reports a task that stops with code %d as an error line, off a terminal', (code) => {
    setTerminal(false);

    const task = taskSpinner();
    task.start('Installing dependencies with npm...');
    task.stop('Failed to install dependencies', code);

    expect(written).toContain('Failed to install dependencies');
    expect(written).not.toContain(ERASE_LINE);
  });

  test('animates in a terminal', async () => {
    setTerminal(true);

    const task = taskSpinner();
    task.start('Installing dependencies with npm...');
    await Bun.sleep(300);
    task.stop('Dependencies installed successfully!');

    expect(written).toMatch(SPINNER_FRAMES);
    expect(written).toContain(ERASE_LINE);
  });
});
