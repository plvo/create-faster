# Updating Libraries Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a rigid technique skill that guides Claude through safely updating library/addon versions in create-faster, catching breaking changes before they reach generated projects.

**Architecture:** Single SKILL.md following the project's existing skill conventions (see adding-templates, fixing-templates for style reference). TDD for skills: baseline test → write skill → verify → close loopholes.

**Tech Stack:** Markdown skill file, subagent-based testing

---

### Task 1: RED — Run baseline test without skill

**Purpose:** Document what an agent naturally does wrong when asked to update a library. This identifies what the skill needs to teach.

**Step 1: Dispatch a subagent with the update task**

Send a subagent (research-only, no writes) with this prompt:
> "You are working on the create-faster CLI tool. I need you to plan how you would update better-auth from ^1.4.10 to ^1.5.3 in this project. Better-auth 1.5 has breaking changes — adapters (drizzle, prisma) have been moved to separate packages (@better-auth/drizzle-adapter, @better-auth/prisma-adapter). Plan your approach step by step. Do NOT make any changes — just tell me your plan."

The agent should have access to the codebase but NOT the updating-libraries skill.

**Step 2: Document baseline behavior**

Record:
- Did it research the library docs / changelog first?
- Did it identify ALL touchpoints (META, direct templates, cross-references, tests)?
- Did it plan to verify with test generation?
- Did it plan to test cross-library combinations?
- What steps did it skip or get wrong?
- What rationalizations did it use for shortcuts?

**Step 3: Save baseline notes**

Save findings temporarily (mental notes are fine — they inform the skill content).

**Expected failures:** Agent likely skips context7 research, misses some cross-references, doesn't plan combination testing, doesn't plan generation verification.

---

### Task 2: GREEN — Write the skill

**Files:**
- Create: `.claude/skills/updating-libraries/SKILL.md`

**Step 1: Create directory**

```bash
mkdir -p .claude/skills/updating-libraries
```

**Step 2: Write SKILL.md**

Write the skill following the design doc (docs/plans/2026-03-05-updating-libraries-design.md) and addressing specific baseline failures from Task 1.

Structure:
```markdown
---
name: updating-libraries
description: Use when updating library or project addon versions in create-faster __meta__.ts, especially when the update may involve breaking changes, new packages, renamed APIs, or cross-integration impacts
---

# Updating Libraries in create-faster

## Overview
## When to Use / When NOT to Use
## Phase 1 — Research (context7 + changelog)
## Phase 2 — Map Touchpoints (4-category inventory)
## Phase 3 — Update (META + templates + cross-refs)
## Phase 4 — Verify (tests + critical combinations + generation)
## Phase 5 — Commit
## Checklist
## Common Rationalizations — STOP
## Red Flags
## Quick Reference
```

Key content to include:
- Flowchart showing phase gates (Phase 2 gates Phase 3, tests gate generation)
- Concrete grep/glob commands for touchpoint discovery
- Combination derivation method (from cross-reference conditionals)
- Generation + build verification commands
- Rationalization table targeting baseline failures
- Red flags list

**Step 3: Review against design doc**

Verify the skill covers all 5 phases, all constraints, and addresses baseline failures.

---

### Task 3: GREEN — Test with skill loaded

**Step 1: Dispatch a subagent WITH the skill**

Same prompt as Task 1, but include the skill content in the prompt:
> "You are working on the create-faster CLI tool. You have a skill for this — read .claude/skills/updating-libraries/SKILL.md first, then plan how you would update better-auth from ^1.4.10 to ^1.5.3. Better-auth 1.5 has breaking changes — adapters moved to separate packages. Plan your approach step by step. Do NOT make any changes."

**Step 2: Compare against baseline**

- Does the agent now follow all 5 phases?
- Does it use context7 for research?
- Does it build the full touchpoint inventory?
- Does it plan combination testing?
- Does it plan generation verification?

**Expected:** Agent follows the skill's process. If not, identify gaps → Task 4.

---

### Task 4: REFACTOR — Close loopholes

**Step 1: Identify new rationalizations**

From Task 3 testing, find any:
- Steps the agent tried to skip despite the skill
- Ambiguous instructions the agent interpreted loosely
- Missing edge cases

**Step 2: Update SKILL.md**

- Add explicit counters for new rationalizations
- Clarify ambiguous sections
- Add to rationalization table and red flags

**Step 3: Re-test if needed**

If significant changes were made, run Task 3 again.

---

### Task 5: Commit

**Step 1: Stage and commit**

```bash
git add .claude/skills/updating-libraries/SKILL.md
git add docs/plans/2026-03-05-updating-libraries-design.md
git add docs/plans/2026-03-05-updating-libraries-implementation.md
git commit -m "feat(skills): add updating-libraries skill

Rigid technique skill for safely updating library and project addon
versions in __meta__.ts. Covers research (context7 + changelog),
touchpoint mapping, update, verification (tests + generation), and
commit phases."
```
