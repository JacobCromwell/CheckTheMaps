/**
 * Developer-facing text, kept in one place so the tone stays consistent.
 */

import { SIZES, elementLabel, orderElements, type Framework } from './core/frameworks';
import type { RequestSize } from './core/triage';

export function help(framework: Framework): string {
	return `**Check The MAPS** checks your prompt against ${framework.name}, then hands it to Copilot.

Type your request after \`@maps\`, for example:

\`@maps add retry with exponential backoff to fetchUser in api.ts\`

Clear prompts go straight through. If something important is missing, you'll get one to three quick questions and a suggested rewrite instead.

- \`@maps /check …\` checks a prompt without sending it
- \`@maps /send …\` skips the check
- \`@maps /explain\` explains ${framework.name}`;
}

const SIZE_ROWS: Record<RequestSize, string> = {
	small: 'Small edit or question ("rename helloWorld to helloDolly")',
	task: 'Bug fix or feature in existing code',
	large: 'Multi-file refactor or migration',
	design: 'Design, architecture or technology choice',
};

/** The /explain text for a framework: what each element means and which requests need it. */
export function explain(framework: Framework): string {
	const elements = framework.elements
		.map(e => `- **${e.label}**${e.meaning ? `: ${sentence(e.meaning)}` : ''}${e.example ? ` For example: _${e.example.replace(/[.\s]+$/, '')}_.` : ''}`)
		.join('\n');
	const rows = SIZES.map(size => `| ${SIZE_ROWS[size]} | ${labelList(framework, framework.requiredBySize[size])} |`).join('\n');
	const source = framework.source ? ` (${framework.source})` : '';
	const parts = [
		`**${framework.name}**${source} is a ${framework.elements.length}-part checklist for prompts:`,
		elements,
		'Not every prompt needs every part:',
		`| Request | Needs |\n|---|---|\n${rows}`,
	];
	if (framework.note) {
		parts.push(framework.note);
	}
	parts.push('_Change the framework with **Check The MAPS: Choose Prompt Framework**._');
	return parts.join('\n\n');
}

/** Ends text with exactly one period. */
export function sentence(text: string): string {
	return `${text.trim().replace(/[.\s]+$/, '')}.`;
}

function labelList(framework: Framework, ids: readonly string[]): string {
	return ids.map(id => elementLabel(framework, id)).join(', ') || '–';
}

export const SIZE_LABELS: Record<RequestSize, string> = {
	small: 'a small request',
	task: 'a task',
	large: 'a multi-file change',
	design: 'a design question',
};

export const JUSTIFICATION =
	'Check The MAPS uses a low-cost model to check your prompt before it goes to Copilot.';

/** "Parameters", "Parameters and Shape", "Mission, Parameters and Shape". */
export function joinLabels(framework: Framework, ids: readonly string[]): string {
	const labels = ids.map(id => elementLabel(framework, id));
	if (labels.length <= 1) {
		return labels.join('');
	}
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** "For a task: Ask ✓ · Parameters ✗" */
export function checklist(framework: Framework, size: RequestSize, missing: readonly string[]): string {
	const required = orderElements(framework, framework.requiredBySize[size]);
	const marks = required.map(id => `${elementLabel(framework, id)} ${missing.includes(id) ? '✗' : '✓'}`);
	return `For ${SIZE_LABELS[size]}: ${marks.join(' · ')}`;
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
