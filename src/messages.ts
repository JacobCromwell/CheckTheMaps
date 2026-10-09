/**
 * Developer-facing text, kept in one place so the tone stays consistent.
 */

import type { RequestSize } from './core/triage';
import { MAPS_LABELS, MAPS_ORDER, REQUIRED_BY_SIZE, type MapsElement } from './core/rubric';

export const HELP = `**Check The MAPS** checks your prompt, then hands it to Copilot.

Type your request after \`@maps\`, for example:

\`@maps add retry with exponential backoff to fetchUser in api.ts\`

Clear prompts go straight through. If something important is missing, you'll get one to three quick questions and a suggested rewrite instead.

- \`@maps /check …\` checks a prompt without sending it
- \`@maps /send …\` skips the check
- \`@maps /explain\` explains MAPS`;

export const EXPLAIN = `**MAPS** is a four-part checklist for prompts:

- **Mission**: why you want this, the outcome that matters.
- **Ask**: the specific task or deliverable.
- **Parameters**: facts the AI can't guess, such as your stack, constraints, the files involved, scale, what must not change, or the exact error.
- **Shape**: what the answer should look like, such as a plan, a diff, a short answer, or options with trade-offs.

Not every prompt needs all four:

| Request | Needs |
|---|---|
| Small edit or question ("rename helloWorld to helloDolly") | Ask |
| Bug fix or feature in existing code | Ask, Parameters |
| Multi-file refactor or migration | Ask, Parameters, Shape |
| Design, architecture or technology choice | Mission, Ask, Parameters, Shape |

Missing **Parameters** is the usual cause of confident answers built on wrong guesses. Missing **Shape** is the usual cause of long answers that wander off topic.`;

export const SIZE_LABELS: Record<RequestSize, string> = {
	small: 'a small request',
	task: 'a task',
	large: 'a multi-file change',
	design: 'a design question',
};

export const JUSTIFICATION =
	'Check The MAPS uses a low-cost model to check your prompt before it goes to Copilot.';

/** "Parameters", "Parameters and Shape", "Mission, Parameters and Shape". */
export function joinLabels(elements: readonly MapsElement[]): string {
	const labels = elements.map(e => MAPS_LABELS[e]);
	if (labels.length <= 1) {
		return labels.join('');
	}
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** "For a task: Ask ✓ · Parameters ✗" */
export function mapsChecklist(size: RequestSize, missing: readonly MapsElement[]): string {
	const required = MAPS_ORDER.filter(e => REQUIRED_BY_SIZE[size].includes(e));
	const marks = required.map(e => `${MAPS_LABELS[e]} ${missing.includes(e) ? '✗' : '✓'}`);
	const label = SIZE_LABELS[size];
	return `For ${label}: ${marks.join(' · ')}`;
}

/** Wraps text in a code fence that can't be broken by backticks inside it. */
export function fence(text: string, language = 'text'): string {
	const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const ticks = '`'.repeat(longestRun + 1);
	return `${ticks}${language}\n${text}\n${ticks}`;
}

/**
 * Escapes characters that would let model text create links, images or HTML.
 * Backticks are kept so identifiers can still render as inline code.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\[\]<>]/g, ch => `\\${ch}`);
}
