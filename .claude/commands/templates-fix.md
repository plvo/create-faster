---
description: Fix formatting issues in Handlebars templates systematically
---

Systematically fix template formatting issues following the `fixing-templates` skill.

This command will guide you through:
- Comprehensive audit of ALL templates with grep
- Identifying and grouping issues by pattern type
- Fixing one pattern type across all files systematically
- Verifying fixes through actual project generation
- Documenting patterns for future reference

**Core principle:** Audit comprehensively, fix consistently, verify output.

**Common patterns fixed:**
- Trailing spaces in script commands and JSX
- Double spaces in Handlebars conditions
- Mixed tabs and spaces (converts to 2-space indentation)
