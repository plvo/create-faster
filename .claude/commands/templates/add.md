# Template Generator Assistant

Generate new stack or module templates based on user description and documentation resources.

## Task

You are an intelligent template generator. Your job is to create production-ready template files for a new stack or module in the create-faster CLI project.

## Input Format

User will provide:
- **Description**: Natural language description of what to add (e.g., "Add Astro web framework with SSR")
- **Resources** (optional): Documentation URLs to fetch and analyze

Example:
```
/templates:add "Add tRPC module for Next.js with server/client setup" --resources https://trpc.io/docs/nextjs
```

## Execution Steps

### 1. Parse & Research Phase

1. **Extract information from description:**
   - Type: stack (app/server/orm/database/extras) or module (nextjs/expo/hono/express)
   - Name: astro, trpc, auth-js, etc.
   - Key features: SSR, edge runtime, type safety, etc.

2. **Fetch resources if provided:**
   - Use WebFetch to get documentation
   - Extract: setup steps, dependencies, configuration files
   - Note latest package versions

3. **Analyze existing similar templates:**
   - Find closest match (e.g., for Astro → look at app/nextjs/)
   - For modules → look at modules/{framework}/shadcn/
   - Identify patterns: magic comments, scope, structure

### 2. Planning Phase

Determine:
- **Scope**: `app` (application), `package` (shared turborepo package), or `root` (config files)
- **Magic comments needed**:
  - `@repo:turborepo` if only for monorepo
  - `@repo:single` if only for single repo
  - `@scope:package` if should go to packages/
- **Files to create**:
  - package.json.hbs (always)
  - tsconfig.json.hbs (if TypeScript)
  - Config files specific to stack
  - Source files (index.ts, etc.)
- **Dependencies**: Extract from docs + check npm for latest versions
- **Integration points**: How it connects to Next.js, ORM, etc.

### 3. Generation Phase

**For each file to create:**

1. **Use existing templates as reference**
   - Copy structure from similar stack
   - Adapt Handlebars conditions for new context

2. **package.json.hbs structure:**
   ```handlebars
   {{!-- Magic comment if needed --}}
   {
     "name": "{{#if (eq repo "turborepo")}}@repo/name{{else}}name{{/if}}",
     "version": "0.0.0",
     "private": true,
     "scripts": {
       {{!-- Add relevant scripts --}}
     },
     "dependencies": {
       {{!-- Core dependencies --}}
       {{#if (eq database "postgres")}}
       {{!-- Database-specific deps --}}
       {{/if}}
     },
     "devDependencies": {
       {{!-- Dev dependencies --}}
     }
   }
   ```

3. **Follow patterns:**
   - Drizzle pattern: Separate src/index.ts (turborepo) and src/lib/db/index.ts (single)
   - Prisma pattern: Different exports for single vs turborepo
   - Module pattern: Use packageName for turborepo placement

4. **Add magic comments:**
   - First line: `{{!-- @repo:turborepo @scope:package --}}` if needed
   - For single repo versions: `{{!-- @repo:single --}}`

### 4. META Registration

Update `apps/cli/src/__meta__.ts`:

**For stack:**
```typescript
app: {
  scope: 'app',
  stacks: {
    astro: {
      label: 'Astro',
      hint: 'Fast static site framework',
      hasBackend: false,
    }
  }
}
```

**For app module:**
```typescript
MODULES: {
  nextjs: {
    trpc: {
      label: 'tRPC',
      hint: 'End-to-end type safety',
      requires: ['database'],
      packageName: 'trpc', // If turborepo package
    }
  }
}
```

**For server module:**
```typescript
MODULES: {
  hono: {
    openapi: {
      label: 'OpenAPI',
      hint: 'API documentation',
      packageName: 'openapi', // If turborepo package
    }
  }
}
```

### 5. Validation Phase

1. Run `/templates:test` on generated files
2. Check:
   - JSON syntax valid
   - No trailing commas
   - Magic comments correct
   - Handlebars compiles
3. Report validation results

### 6. Documentation

Create README-like summary:
```markdown
# Generated: <stack-name>

## Files Created
- templates/<category>/<name>/package.json.hbs
- templates/<category>/<name>/tsconfig.json.hbs
- ...

## META Updated
Added entry to __meta__.ts

## Usage
Select "<name>" during CLI prompts

## Dependencies
- package@version (description)
- ...

## Next Steps
1. Review generated files
2. Test with: /templates:test "<category>/<name>/**"
3. Run CLI to generate project: bun run dev:cli
```

## Important Guidelines

1. **Use latest stable versions** - Check npm for current versions
2. **Follow existing patterns** - Don't invent new structures
3. **Add proper conditions** - Use Handlebars helpers correctly
4. **Validate everything** - Run test command before finishing
5. **Be thorough** - Include all necessary files for the stack to work
6. **Document choices** - Explain why certain dependencies or structure

## Context-Aware Conditions

Common Handlebars patterns to use:

- `{{#if (eq repo "single")}}` - Single repo only
- `{{#if (eq repo "turborepo")}}` - Monorepo only
- `{{#if (eq orm "drizzle")}}` - If Drizzle ORM selected
- `{{#if (eq database "postgres")}}` - Database-specific
- `{{#if (hasModule "shadcn")}}` - If app module enabled
- `{{#if (hasServerModule "openapi")}}` - If server module enabled
- `{{#if (hasApp this)}}` - If app exists
- `{{#if (hasServer this)}}` - If server exists
- `{{#if (isFullstack this)}}` - If fullstack (app + server)
- `{{#if (and (eq repo "single") (eq orm "drizzle"))}}` - Multiple conditions

## Output Format

After generation, provide:
1. List of files created with paths
2. Summary of changes to __meta__.ts
3. Validation results from /templates:test
4. Usage instructions for testing

## Example Workflow

```
User: /templates:add "Add Astro framework" --resources https://docs.astro.build

1. ✓ Parsed: type=app, name=astro
2. ✓ Fetched Astro docs
3. ✓ Analyzed app/nextjs/ as reference
4. ✓ Created 5 files in templates/app/astro/
5. ✓ Updated __meta__.ts
6. ✓ Ran /templates:test - All valid
7. ✅ Done! Ready to test with CLI
```

---

**Remember**: Quality over speed. Generated templates should be production-ready and follow all project conventions.
