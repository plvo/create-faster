// ABOUTME: Validation tests for META constant
// ABOUTME: Ensures META has all required stacks, modules with valid packageJson

import { describe, test, expect } from 'bun:test';
import { META } from '../src/__meta__';
import { isModuleCompatible } from '../src/types/meta';

describe('META validation', () => {
  describe('stacks', () => {
    test('has all required stacks', () => {
      expect(META.stacks.nextjs).toBeDefined();
      expect(META.stacks.expo).toBeDefined();
      expect(META.stacks.hono).toBeDefined();
      expect(META.stacks['tanstack-start']).toBeDefined();
    });

    test('each stack has type, label, and packageJson', () => {
      for (const [name, stack] of Object.entries(META.stacks)) {
        expect(stack.type, `${name} should have type`).toBeDefined();
        expect(stack.label, `${name} should have label`).toBeDefined();
        expect(stack.packageJson, `${name} should have packageJson`).toBeDefined();
      }
    });

    test('nextjs has required dependencies', () => {
      const deps = META.stacks.nextjs.packageJson.dependencies;
      expect(deps?.next).toBeDefined();
      expect(deps?.react).toBeDefined();
      expect(deps?.['react-dom']).toBeDefined();
    });

    test('nextjs has dev script', () => {
      const scripts = META.stacks.nextjs.packageJson.scripts;
      expect(scripts?.dev).toContain('next dev');
    });
  });

  describe('modules', () => {
    test('shadcn is compatible with nextjs and tanstack-start', () => {
      const shadcn = META.modules.shadcn;
      expect(isModuleCompatible(shadcn, 'nextjs')).toBe(true);
      expect(isModuleCompatible(shadcn, 'tanstack-start')).toBe(true);
      expect(isModuleCompatible(shadcn, 'expo')).toBe(false);
    });

    test('shadcn has asPackage and singlePath', () => {
      expect(META.modules.shadcn.asPackage).toBe('ui');
      expect(META.modules.shadcn.singlePath).toBeDefined();
    });

    test('tanstack-query is compatible with all stacks', () => {
      const query = META.modules['tanstack-query'];
      expect(query.stacks).toBe('all');
      expect(isModuleCompatible(query, 'nextjs')).toBe(true);
      expect(isModuleCompatible(query, 'expo')).toBe(true);
      expect(isModuleCompatible(query, 'hono')).toBe(true);
    });

    test('modules with asPackage have exports', () => {
      for (const [name, module] of Object.entries(META.modules)) {
        if (module.asPackage) {
          expect(module.packageJson.exports, `${name} with asPackage should have exports`).toBeDefined();
        }
      }
    });
  });

  describe('orm', () => {
    test('drizzle has required config', () => {
      const drizzle = META.orm.stacks.drizzle;
      expect(drizzle.asPackage).toBe('db');
      expect(drizzle.singlePath).toBeDefined();
      expect(drizzle.packageJson.dependencies?.['drizzle-orm']).toBeDefined();
      expect(drizzle.packageJson.devDependencies?.['drizzle-kit']).toBeDefined();
      expect(drizzle.packageJson.scripts?.['db:generate']).toBeDefined();
    });

    test('orm requires database', () => {
      expect(META.orm.requires).toContain('database');
    });
  });

  describe('database', () => {
    test('postgres has driver dependency', () => {
      const deps = META.database.stacks.postgres.packageJson?.dependencies;
      expect(deps?.pg).toBeDefined();
    });

    test('mysql has driver dependency', () => {
      const deps = META.database.stacks.mysql.packageJson?.dependencies;
      expect(deps?.mysql2).toBeDefined();
    });
  });

  describe('extras', () => {
    test('husky requires git', () => {
      expect(META.extras.stacks.husky.requires).toContain('git');
    });

    test('biome has dependency and scripts', () => {
      const biome = META.extras.stacks.biome;
      expect(biome.packageJson?.devDependencies?.['@biomejs/biome']).toBeDefined();
      expect(biome.packageJson?.scripts?.format).toBeDefined();
      expect(biome.packageJson?.scripts?.lint).toBeDefined();
    });
  });
});
