import { describe, expect, test } from 'bun:test';
import { runCommand } from '@/lib/run-command';

function runScript(script: string) {
  return runCommand(`"${process.execPath}" -e "${script}"`, process.cwd());
}

describe('runCommand', () => {
  test('a successful command with more than 1 MB of output succeeds', async () => {
    const result = await runScript(
      "process.stdout.write('x'.repeat(5_000_000)); process.stderr.write('y'.repeat(5_000_000))",
    );

    expect(result.success).toBe(true);
  });

  test('a failed command with huge output keeps only the end of it', async () => {
    const result = await runScript("for (let i = 1; i <= 200000; i++) console.error('line-' + i); process.exit(1)");

    expect(result.success).toBe(false);
    expect(result.output).toContain('line-200000');
    expect(result.output).not.toContain('line-1\n');
    expect(result.output.split('\n').length).toBeLessThanOrEqual(20);
  });

  test('a failed command reports stdout when stderr is empty', async () => {
    const result = await runScript("console.log('only on stdout'); process.exit(1)");

    expect(result.output).toContain('only on stdout');
  });

  test('a command that cannot start fails with the reason', async () => {
    const result = await runCommand('true', '/nonexistent-directory-for-run-command');

    expect(result.success).toBe(false);
    expect(result.output).toContain('ENOENT');
  });

  test('a slow command is not cut short', async () => {
    const result = await runScript('setTimeout(() => {}, 1500)');

    expect(result.success).toBe(true);
  });
});
