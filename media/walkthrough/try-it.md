# Check your first prompt

Open the chat and start your prompt with `@maps`:

```
@maps add retry with exponential backoff to fetchUser in api.ts
```

**Clear prompts go straight through.** You'll see a one-line ✅ and Copilot picks the prompt up right away. Small, specific requests (like renaming a function) don't even call a model, so they pass instantly.

**Vague prompts get a quick nudge.** For example:

```
@maps help me design a caching layer
```

You'll see what's missing, one to three questions worth answering, and a suggested rewrite. Click **Edit suggested prompt** to fill in the blanks, or **Send mine anyway** to carry on.

`@maps` stays in the chat box after each prompt, so every prompt you send is checked. Delete it to send a prompt without a check.
