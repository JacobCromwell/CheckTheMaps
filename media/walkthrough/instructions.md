# Let Copilot check too

`@maps` checks a prompt before Copilot sees it. You can also ask Copilot itself to watch for the same gaps.

**Add Guidance to Copilot Instructions** writes a short, clearly marked section into `.github/copilot-instructions.md` (or `AGENTS.md`). It asks Copilot to:

- check bigger requests against your framework before starting
- ask one or two specific questions when something essential is missing, instead of guessing
- state its assumptions in a line
- keep answers to what was asked, in the format you asked for

This works even for prompts sent without `@maps`. It isn't a replacement for the check, though: it runs on your chat model rather than a cheap one, and a model can choose not to follow instructions.

Run the command again at any time to update the section (for example after changing frameworks) or remove it. The rest of the file is never touched.
