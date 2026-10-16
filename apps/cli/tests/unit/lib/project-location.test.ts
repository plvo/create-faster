import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { getProjectDir, getProjectPath, projectNameOf, quoteProjectDir, validateAppName, validateProjectName } from '@/lib/project-location';

describe('projectNameOf', () => {
  test.each([
    ['my-app', 'my-app'],
    ['../out/my-app', 'my-app'],
    ['./apps/my-app', 'my-app'],
    ['/abs/out/my-app', 'my-app'],
    ['apps/my-app/', 'my-app'],
  ])('%s is named %s', (input, expected) => {
    expect(projectNameOf(input)).toBe(expected);
  });
});

describe('validateProjectName', () => {
  test.each(['my-app', 'app2', 'my_app', 'my.app'])('accepts %s', (name) => {
    expect(validateProjectName(name)).toBeUndefined();
  });

  test.each(['My App', 'MyApp', '.', '..', '.hidden', '-app', '_app', ''])('refuses "%s"', (name) => {
    expect(validateProjectName(name)).toContain('Project name');
  });
});

describe('validateAppName', () => {
  test('applies the project name rule under its own label', () => {
    expect(validateAppName('my.app_1')).toBeUndefined();
    expect(validateAppName('My App')).toContain('App name "My App"');
  });
});

describe('project location', () => {
  test('a context without projectDir targets the project name under the working directory', () => {
    const ctx = { projectName: 'my-app' };
    expect(getProjectDir(ctx)).toBe('my-app');
    expect(getProjectPath(ctx)).toBe(resolve(process.cwd(), 'my-app'));
  });

  test('a relative directory resolves against the working directory', () => {
    expect(getProjectPath({ projectName: 'my-app', projectDir: '../out/my-app' })).toBe(
      resolve(process.cwd(), '../out/my-app'),
    );
  });

  test('an absolute directory is kept', () => {
    expect(getProjectPath({ projectName: 'my-app', projectDir: '/abs/out/my-app' })).toBe('/abs/out/my-app');
  });
});

describe('quoteProjectDir', () => {
  test.each(['my-app', '../out/my-app', '/abs/out/my-app', './apps/my-app'])('leaves %s as is', (value) => {
    expect(quoteProjectDir(value)).toBe(value);
  });

  test.each([
    ['-x/my-app', './-x/my-app'],
    ['-x/my app', "'./-x/my app'"],
    ['=ls/my-app', "'=ls/my-app'"],
    ['+1/my-app', "'+1/my-app'"],
    ['~/my-app', "'~/my-app'"],
    ['../my dir/my-app', "'../my dir/my-app'"],
    ['a$(id)/my-app', "'a$(id)/my-app'"],
    ['a;rm -rf x/my-app', "'a;rm -rf x/my-app'"],
    ["it's/my-app", "'it'\\''s/my-app'"],
  ])('quotes %s', (value, expected) => {
    expect(quoteProjectDir(value)).toBe(expected);
  });
});
