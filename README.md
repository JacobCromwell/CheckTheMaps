# Check The MAPS

A fast, low-cost pre-flight check for your Copilot prompts.

Start a chat prompt with `@maps`. If the prompt is clear, it goes straight to Copilot with a small ✅ and you keep working. If something important is missing, you get one to three pointed questions and a suggested rewrite before Copilot spends time (and credits) guessing.

Prompts are checked against MAPS (Mission, Ask, Parameters, Shape) by default. You can switch to CO-STAR, RISEN or RTF, or give your team its own checklist.

The check uses the cheapest model available to you, never the premium model you chat with, and it never gets in the way: if anything goes wrong, your prompt is sent on unchecked.

## Why

Vague prompts cause two familiar problems:

- **Sprawl.** Without a clear scope or format, the AI writes far more than you need, much of it only loosely related.
- **Confident guessing.** Without the facts it needs, the AI fills the gaps with assumptions and presents the result with full confidence.

Check The MAPS catches those prompts at the moment they're cheapest to fix: before you send them.

## What it looks like

A clear prompt:

> **You:** `@maps rename the function helloWorld to helloDolly`
>
> **Check The MAPS:** ✅ Looks good. Sent to Copilot.

Copilot then picks the prompt up as if you had sent it directly. Small, specific requests like this one are recognized by local rules, so there's no model call and no wait.

A prompt that needs more:

> **You:** `@maps help me design a caching layer`
>
> **Check The MAPS:** ⚠️ **Missing Parameters and Shape.** No scale, stack or output format given.
>
> _For a design question: Mission ✓ · Ask ✓ · Parameters ✗ · Shape ✗_
>
> **Worth answering first:**
> 1. Which service is this for, and roughly how many requests per second?
> 2. Do you want a short written plan, or code?
>
> **Suggested prompt.** Replace the [brackets] with your details.
> ```text
> Design a caching layer for [service] handling [expected load]. We use [stack]. Give a short written plan with trade-offs.
> ```
> `Edit suggested prompt`  `Send mine anyway`

**Edit suggested prompt** puts the rewrite in the chat box (with `@maps` in front) so you can fill in the blanks. If you send it with a placeholder still unfilled, you'll get a gentle reminder instead of another check.

## MAPS, the default framework

MAPS, from Dan Martell, is a four-part checklist for prompts:

| | Means | Example |
|---|---|---|
| **Mission** | Why you want this, the outcome that matters | "so checkout stays under 200 ms at peak" |
| **Ask** | The specific task or deliverable | "add a read-through cache to `getProduct`" |
| **Parameters** | Facts the AI can't guess | stack, constraints, files, scale, what must not change, the exact error |
| **Shape** | What the answer should look like | "a short plan with trade-offs", "just the diff", "under 200 words" |

Not every prompt needs all four. The check scales with the size of the request:

| Request | Needs |
|---|---|
| Small edit or question ("rename helloWorld to helloDolly") | Ask |
| Bug fix or feature in existing code | Ask, Parameters |
| Multi-file refactor or migration | Ask, Parameters, Shape |
| Design, architecture or technology choice | Mission, Ask, Parameters, Shape |

Context Copilot already has counts: attached files, selected code, the active file (and its errors), your instructions files, and earlier prompts in the chat. "Fix this" with code selected passes.

## Choosing a different framework

MAPS is the default, but you can check prompts against another checklist. Run **Check The MAPS: Choose Prompt Framework**, or use the **Framework** item in the status bar menu.

| Framework | Parts | Needed for a task | Needed for a design question |
|---|---|---|---|
| **MAPS** (Dan Martell), the default | Mission, Ask, Parameters, Shape | Ask, Parameters | all four |
| **CO-STAR** (GovTech Singapore) | Context, Objective, Style, Tone, Audience, Response | Context, Objective | Context, Objective, Audience, Response |
| **RISEN** (Kyle Balmer) | Role, Instructions, Steps, End goal, Narrowing | Instructions, Narrowing | Instructions, End goal, Narrowing |
| **RTF** | Role, Task, Format | Task | Task, Format |
| **Your own** | whatever your team uses | you decide | you decide |

Every framework scales the same way: small edits only need the task itself to be clear, and parts that are optional for coding prompts (CO-STAR's Style and Tone, RISEN's Role and Steps, RTF's Role) are never flagged. CO-STAR was created by GovTech Singapore's Data Science & AI team and popularized by Sheila Teo. Messages, the checklist line, `/explain` and the checker's questions all use the framework you choose.

### Your own framework

Choosing **Define your own framework…** adds a starter framework to your settings and opens it. Or write it yourself in `settings.json`:

```json
"checkTheMaps.framework": "custom",
"checkTheMaps.customFramework": {
  "name": "Our checklist",
  "elements": [
    { "id": "ticket", "label": "Ticket", "meaning": "the issue or ticket this is for" },
    { "id": "change", "label": "Change", "meaning": "the specific change you need" },
    { "id": "context", "label": "Context", "meaning": "files, constraints, errors and what must not change" },
    { "id": "done", "label": "Done when", "meaning": "how you'll know it worked, such as which tests should pass" }
  ],
  "taskElement": "change",
  "requiredBySize": {
    "task": ["change", "context"],
    "large": ["ticket", "change", "context", "done"],
    "design": ["ticket", "change", "context", "done"]
  }
}
```

- `elements` (required): up to eight parts. Plain strings work too: `["Goal", "Task", "Context"]`.
- `taskElement`: the part that states the task. Small requests need only this one, and every size needs it. If you leave it out, the first entry in `requiredBySize.small` is used, then a part named like "Task", "Ask" or "Objective", then the first part.
- `requiredBySize`: which parts each size needs (`task`, `large`, `design`). Missing sizes get sensible defaults.

Put both settings in the workspace settings (`.vscode/settings.json`) and commit them, and everyone on the team is checked against the same list. If the custom framework can't be used, you'll see what's wrong, and MAPS is used until it's fixed. In Restricted Mode, workspace settings can't choose the framework (or the checker model), so your user settings apply.

## Copilot instructions (optional)

Instructions files can't send prompts through `@maps`: by the time Copilot reads them, VS Code has already decided which participant answers. They can still help from the other side. **Check The MAPS: Add Guidance to Copilot Instructions** writes a short, clearly marked section into `.github/copilot-instructions.md` (read on every Copilot request) or `AGENTS.md` (read by other coding agents, and by Copilot when `chat.useAgentsMdFile` is on). It asks the agent to:

- check bigger requests against your framework before starting
- ask one or two specific questions when something essential is missing, instead of guessing
- state its assumptions, and keep answers to what was asked, in the format asked for

This works even for prompts sent without `@maps`. It runs on your chat model, and a model can choose not to follow instructions, so treat it as a complement to the check, not a replacement. Run the command again to update the section (for example after changing frameworks) or remove it. Nothing else in the file is touched.

## Getting started

Requirements: VS Code 1.103 or later, and GitHub Copilot Chat (or another chat agent set as the default).

1. Install the extension (see [Installing](#installing)).
2. Open the chat and type `@maps` followed by your prompt, or run **Check The MAPS: Start a Checked Prompt**.
3. The first check asks you to allow Check The MAPS to use a language model. That's a one-time VS Code prompt.

After each prompt, `@maps` goes back into the chat box, so everything you send is checked. Delete it to send a single prompt without a check, or turn off `checkTheMaps.keepMapsInChatBox`.

The **Get Started with Check The MAPS** walkthrough (on the Welcome page) covers the same ground in four short steps.

## Commands

In the chat:

| Command | What it does |
|---|---|
| `@maps <prompt>` | Check the prompt, then send it to Copilot if it passes |
| `@maps /check <prompt>` | Check the prompt without sending it |
| `@maps /send <prompt>` | Skip the check and send straight to Copilot |
| `@maps /explain` | Explain the active framework (MAPS by default) |

In the Command Palette, under **Check The MAPS**: Start a Checked Prompt, Choose Prompt Framework, Choose Checker Model, Set Strictness, Toggle Sending Passing Prompts Automatically, Explain the Prompt Framework, Add Guidance to Copilot Instructions, Open Settings, Show Log and Show Menu.

The **MAPS** item in the status bar shows a green check after a passing prompt and a warning after a flagged one. Click it for settings and today's numbers.

To start checked prompts from the keyboard, add a keybinding for `checkTheMaps.startCheckedPrompt` (for example in **Preferences: Open Keyboard Shortcuts (JSON)**):

```json
{ "key": "ctrl+alt+;", "command": "checkTheMaps.startCheckedPrompt" }
```

## Settings

| Setting | Default | |
|---|---|---|
| `checkTheMaps.autoSend` | `true` | Send passing prompts to Copilot automatically. When off, you get a **Send to Copilot** button. |
| `checkTheMaps.framework` | `maps` | The checklist prompts are checked against: `maps`, `co-star`, `risen`, `rtf` or `custom`. |
| `checkTheMaps.customFramework` | empty | Your own framework, used when `framework` is `custom`. See [Your own framework](#your-own-framework). |
| `checkTheMaps.strictness` | `lenient` | `lenient` flags only prompts likely to go wrong. `balanced` flags prompts missing something important for their size. `strict` flags any missing element the size needs. |
| `checkTheMaps.model` | empty | The checker model's id. Empty means the cheapest model with a known price. Use **Choose Checker Model** rather than typing an id. |
| `checkTheMaps.keepMapsInChatBox` | `true` | Put `@maps` back in the Chat view's chat box after a prompt is sent, so the next one is checked too. |
| `checkTheMaps.sendInMode` | empty | Chat mode to send passing prompts in (`agent`, `ask` or a custom agent's name). Empty keeps the current mode, and is the most reliable choice. Any mode other than `ask` is set through the Chat view. Switching into or out of `edit` can start a new chat session. |
| `checkTheMaps.timeoutSeconds` | `8` | How long to wait for the checker before sending unchecked. |
| `checkTheMaps.dailyCheckLimit` | `300` | Most model checks per day; `0` means no limit. Prompts passed by the local rules don't count. |
| `checkTheMaps.showStatusBar` | `true` | Show the MAPS status bar item. |

## What it costs

Copilot bills chat usage in AI credits (one credit is $0.01), priced per token by model. A check sends about 1,000 tokens and gets about 150 back, so on the cheapest models it costs roughly **0.02 credits**: around 50 checks per credit. Prompts that pass the local rules cost nothing.

By default the cheapest model with a known price is used. Models with an unknown price, or that cost more than $5 per million output tokens, are **never picked automatically**. You can still choose one yourself, after a confirmation that shows the estimated cost per check. **Choose Checker Model** lists every model you have with its estimated cost per check, and the status bar menu shows an estimate of today's spend.

Prices come from GitHub's [Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) table and live in [`src/core/models.ts`](src/core/models.ts). Update that table when GitHub changes prices.

## Privacy

- Your prompt, plus a short description of its context (attachment file names, the active file's name and error count, whether code is selected, and up to three earlier prompts from this chat), goes to the checker model through VS Code's language model API. File contents are not sent.
- Daily counts are kept locally in VS Code's storage. There is no telemetry.
- The log (**Check The MAPS: Show Log**) records decisions and timings, not prompt text.

## How it works

1. **Local rules** ([`src/core/triage.ts`](src/core/triage.ts)) recognize obviously small, specific prompts (renames, edits that name a function or file, questions about selected code, short follow-ups) and pass them instantly. Design and multi-file requests are tagged for the checker.
2. **The checker** ([`src/core/rubric.ts`](src/core/rubric.ts)) sizes the request and decides whether it has what that size needs. It's told to pass when in doubt, never to flag style or grammar, and to ask only questions whose answers would change the solution.
3. **Policy** overrides the model where it matters: small requests are never flagged unless the Ask itself is unclear, and elements a size doesn't need are ignored.
4. **Hand-off** ([`src/handoff.ts`](src/handoff.ts)) sends the prompt to Copilot in the chat you're typing in, re-attaching the files and folders you'd attached, so Copilot handles it normally. It waits for VS Code to mark the `@maps` reply complete first (VS Code asks for follow-up suggestions at that moment, which is the signal), because chat ignores new requests while a reply is in progress.

Every failure path (no suitable model, access not granted, timeout, quota, unreadable answer, daily limit) sends the prompt on unchecked with a one-line note.

## Known limitations

- **A prompt that doesn't arrive.** VS Code ignores a new chat request while another is in progress, and gives extensions no way to tell. If a prompt ever doesn't reach Copilot (for example because you sent something else in the same moment), click the small **↻** next to "Sent to Copilot".
- **Images and pasted content** can't be carried over to Copilot. When a prompt has them, it goes back into the chat box so you can add them again and send.
- **The Chat view is used for editing.** **Edit suggested prompt** and putting `@maps` back in the chat box always use the Chat view. If you chat in an editor tab, `@maps` isn't put back (you'll need to type it), and edited prompts open in the Chat view. `@maps` also isn't put back once you've clicked into an editor or switched files after sending, so it never pulls focus away from your code.
- **Selections become whole files.** If you attached a selection, Copilot receives the whole file it came from.
- **Copilot sees the `@maps` exchange.** Copilot reads the whole conversation, so it also sees your `@maps` message and the reply. This is harmless, and after a flagged prompt it can even help.
- **Copilot Free and Student** plans can only use automatic model selection, so a checker model may not be available. In that case prompts are sent on unchecked.
- **Other agent harnesses.** `@maps` is a chat participant, which works in VS Code's own chat sessions. It may not be offered in sessions that run on another harness (Copilot CLI, Claude or Codex sessions). The hook-based mode on the roadmap is the better fit there.

## Installing

Until the extension is on the Marketplace:

- **From CI.** Every push to `main` builds a `.vsix`. Open the latest run under [Actions](https://github.com/JacobCromwell/CheckTheMaps/actions), download **check-the-maps-vsix**, unzip it, then run **Extensions: Install from VSIX…** in VS Code.
- **From source.** `npm install`, then `npm run package`, then install the `.vsix` it creates.

## Development

```bash
npm install
npm test          # compiles, then runs the unit tests
npm run watch     # recompiles on change
npm run package   # builds a .vsix
```

Press **F5** in VS Code to open an Extension Development Host with the extension loaded.

The logic that decides what passes (`src/core/`) has no dependency on VS Code and is covered by unit tests. The chat handler is tested against a small stand-in for the VS Code API (`test/support/vscode.ts`).

To publish to the Marketplace, create a publisher named `jacobcromwell` (or change `publisher` in `package.json`), add a license, then run `npx vsce publish`.

## Roadmap

- **Fully automatic mode** using VS Code's `UserPromptSubmit` agent hook (in preview), so prompts are checked without typing `@maps`.
- **Team rules beyond the checklist**, such as "bug reports must include the error message".
- **Smarter local rules**, tuned from the pass and flag rates in the status bar menu.
