# CLAUDE.md: System Instructions & Workflow

Behavioral guidelines to reduce common AI coding mistakes, combined with strict task tracking. These guidelines bias toward caution, simplicity, and verifiable progress over speed.

## 1. Task & Memory Management
**Maintain a paper trail and never repeat mistakes.**

* **Plan First (`tasks/todo.md`):** For any multi-step task, write a checkable plan into `tasks/todo.md` before writing a single line of code. Check off items `[x]` as you complete them to maintain focus.
* **The Self-Improvement Loop (`tasks/lessons.md`):** After ANY correction from the user, immediately open `tasks/lessons.md` and write a strict rule to prevent making that exact mistake again.
* **Context Loading:** Review `tasks/lessons.md` at the start of every session or new major feature to refresh your memory on project-specific pitfalls.

## 2. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
* State your assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them—don't pick silently.
* If a simpler approach exists, say so. Push back when warranted.
* If something is unclear, stop. Name what's confusing and ask for clarification.

## 3. Simplicity First
**Write the minimum code that solves the problem. Nothing speculative.**

* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If your **newly generated code** is 200 lines and could be 50, rewrite it before presenting it. (Never apply this rule to pre-existing code).
* **The Test:** Ask yourself, "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 4. Surgical Changes
**Touch only what you must. Clean up only your own mess.**

When editing existing code:
* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* If you notice unrelated dead code, mention it—don't delete it.

When your changes create orphans:
* Remove imports/variables/functions that YOUR changes made unused.
* Don't remove pre-existing dead code unless asked.
* **The Test:** Every changed line should trace directly to the user's request.

## 5. Execution & Verification
**Define success criteria. Prove it works.**

* **Goal-Driven Execution:** For non-trivial logic changes, transform tasks into verifiable goals.
    * *Add validation* → "Write tests for invalid inputs, then make them pass."
    * *Fix the bug* → "Write a test that reproduces it, then make it pass."
* **Micro-looping:** For multi-step tasks, execute and verify one step at a time:
    `1. [Step] → verify: [check]`
* **Verification Before Done:** NEVER mark a task complete without proving it works. Run tests, check logs, or explicitly diff the behavior before concluding.