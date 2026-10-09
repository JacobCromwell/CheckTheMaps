# Changelog

## Unreleased

- Hand-offs now send to the chat you're typing in (Chat view, editor tab or Quick Chat) and wait for VS Code to mark the `@maps` reply complete, instead of a fixed delay.
- `@maps` is put back in the chat box after a prompt is sent (`checkTheMaps.keepMapsInChatBox`), unless you've moved on to an editor.
- Files referenced inline (`#file:…`) and attached folders are carried over to Copilot.
- Product names such as "GitHub" or "NextAuth" no longer make a vague prompt look specific.
- The checker's answer is parsed more robustly, answers in the developer's language, and revisions are detected more accurately.
- Every remaining failure path, including model lookup errors and Stop, fails open or stays quiet.
- CI lists the packaged files and surfaces `vsce` warnings.

## 0.1.0

First version.

- `@maps` chat participant that checks a prompt, then hands it to Copilot.
- Local rules pass small, specific prompts instantly, with no model call.
- Everything else is checked against MAPS (Mission, Ask, Parameters, Shape), scaled to the size of the request, by the cheapest model with a known price.
- Flagged prompts get one to three questions, a suggested rewrite, and **Edit suggested prompt** / **Send mine anyway** buttons.
- Fails open: timeouts, errors, missing models and the daily limit never block a prompt.
- `/check`, `/send` and `/explain` commands.
- Status bar item with a green check after passing prompts, plus a menu with settings and today's numbers.
- Checker model picker that shows the cost per check, and a confirmation before choosing a costly model.
- Getting-started walkthrough.
