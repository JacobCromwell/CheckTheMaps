# Pick your prompt framework

Prompts are checked against **MAPS** by default, but you can choose another checklist:

| Framework | Parts | Good fit when |
|---|---|---|
| **MAPS** (Dan Martell) | Mission, Ask, Parameters, Shape | You want a short checklist built around the goal, the facts and the shape of the answer. The default. |
| **CO-STAR** (GovTech Singapore) | Context, Objective, Style, Tone, Audience, Response | You often write for someone else, or care about voice. Style and Tone are optional for coding prompts. |
| **RISEN** (Kyle Balmer) | Role, Instructions, Steps, End goal, Narrowing | You like spelling out the approach and the limits. |
| **RTF** | Role, Task, Format | You want the lightest possible check. |
| **Your own** | Whatever your team uses | Your team already has a checklist, such as "always include the ticket and the acceptance criteria". |

Every framework scales with the request: small edits only need the task itself to be clear, and bigger requests need more of the checklist.

**Your own framework** lives in settings (`checkTheMaps.customFramework`). Save it in the workspace settings and commit `.vscode/settings.json`, and everyone on the team is checked against the same list.
