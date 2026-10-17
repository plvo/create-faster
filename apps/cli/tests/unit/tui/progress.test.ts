import { describe, expect, test } from 'bun:test';
import { Progress } from '@/tui/progress';

describe('Progress', () => {
  test('counts the prompts asked over the prompts still expected', () => {
    const progress = new Progress(() => ['name', 'stack', 'git']);

    expect(progress.message('name', 'Name?')).toContain('1/3');
    expect(progress.message('stack', 'Stack?')).toContain('2/3');
    expect(progress.message('git', 'Git?')).toContain('3/3');
  });

  test('counts a prompt asked twice once', () => {
    const progress = new Progress(() => ['name', 'stack']);

    progress.message('name', 'Name?');

    expect(progress.message('name', 'Name?')).toContain('1/2');
  });

  test('shrinks the total when a later prompt is no longer expected', () => {
    let expected = ['name', 'database', 'orm', 'git'];
    const progress = new Progress(() => expected);

    expect(progress.message('name', 'Name?')).toContain('1/4');
    expected = ['name', 'database', 'git'];
    expect(progress.message('database', 'Database?')).toContain('2/3');
  });

  test('keeps counting a prompt already asked after it stops being expected', () => {
    let expected = ['category', 'git'];
    const progress = new Progress(() => expected);

    progress.message('category', 'Category?');
    expected = ['git'];

    expect(progress.message('git', 'Git?')).toContain('2/2');
  });

  test('marks the asked prompts done, the current one active and the others pending', () => {
    const progress = new Progress(() => ['a', 'b', 'c', 'd']);
    progress.message('a', 'A?');

    expect(progress.message('b', 'B?')).toContain('●◆○○');
  });
});
