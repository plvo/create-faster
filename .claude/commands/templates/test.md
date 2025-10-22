# Template Syntax Validator

Validate all Handlebars templates for syntax errors, JSON correctness, and common issues like trailing commas.

## Task

You are a template validation assistant. Your job is to scan and validate Handlebars template files (.hbs) in the CLI templates directory.

## What to validate

1. **Handlebars Syntax**
   - Compile each template with Handlebars
   - Report compilation errors with line numbers
   - Check for unmatched brackets, invalid helpers

2. **JSON Correctness** (for *.json.hbs files only)
   - Strip Handlebars directives (but keep static JSON)
   - Create minimal mock context for common variables
   - Attempt JSON.parse() and report syntax errors
   - Focus on trailing comma issues

3. **Magic Comments** (first line validation)
   - Valid types: `@repo:`, `@scope:`, `@if:`, `@require:`
   - Valid repo values: `single`, `turborepo`
   - Valid scope values: `app`, `package`, `root`
   - Check for typos like `@scope:packages` (should be `package`)

4. **Common Issues**
   - Trailing commas before `}` or `]`
   - Commas inside conditional blocks that might become trailing
   - Missing commas between array/object items
   - Unclosed Handlebars blocks

## Mock Context for Testing

Use this minimal context for JSON validation:

```javascript
{
  repo: 'single',
  projectName: 'test-project',
  appName: 'test-app',
  framework: 'nextjs',
  platform: 'web',
  database: 'postgres',
  orm: 'drizzle',
  modules: ['shadcn'],
  extras: ['biome'],
  git: true,
  apps: [{
    appName: 'test-app',
    framework: 'nextjs',
    platform: 'web',
    modules: ['shadcn']
  }]
}
```

## Execution Steps

1. Use Glob tool to find all `.hbs` files in `apps/cli/templates/`
2. For each template:
   - Read file content
   - Try to compile with Handlebars (catch errors)
   - If *.json.hbs: render with mock context and validate JSON
   - Check first line for magic comments
   - Report issues

3. Generate summary report:
   ```
   📋 Template Validation Report

   ✅ Valid: 45 templates
   ❌ Errors: 3 templates

   === Errors ===

   ❌ orm/drizzle/package.json.hbs
      Line 29: Trailing comma before }
      Line 32: Possible trailing comma if (eq database "mysql") is false

   ❌ web/nextjs/tsconfig.json.hbs
      Line 15: Handlebars syntax error - unclosed {{#if block

   ✅ Summary: Fix 3 issues across 2 files
   ```

## Pattern Argument (Optional)

If user provides a pattern like `/templates:test "orm/**"`:
- Filter templates using glob pattern
- Only validate matching files

## Important

- Be concise but precise with error messages
- Show file path relative to templates/
- Include line numbers for all errors
- Suggest fixes when obvious (e.g., "Remove comma on line 29")
- Don't modify files, only report issues
