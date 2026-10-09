# Learn your framework

This page describes MAPS, the default. If you've chosen another framework, **Explain the Prompt Framework** (or `@maps /explain`) describes that one instead.

**MAPS** is a four-part checklist for prompts:

- **Mission**: why you want this, the outcome that matters.
- **Ask**: the specific task or deliverable.
- **Parameters**: facts the AI can't guess, such as your stack, constraints, the files involved, scale, what must not change, or the exact error.
- **Shape**: what the answer should look like, such as a plan, a diff, a short answer, or options with trade-offs.

Not every prompt needs all four:

| Request | Needs |
|---|---|
| Small edit or question | Ask |
| Bug fix or feature in existing code | Ask, Parameters |
| Multi-file refactor or migration | Ask, Parameters, Shape |
| Design, architecture or technology choice | Mission, Ask, Parameters, Shape |

Missing **Parameters** is the usual cause of confident answers built on wrong guesses. Missing **Shape** is the usual cause of long answers that wander off topic.
