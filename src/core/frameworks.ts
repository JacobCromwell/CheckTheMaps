/**
 * Prompt frameworks: the checklists a prompt is checked against.
 *
 * MAPS (Dan Martell) is the default. CO-STAR, RISEN and RTF are built in as
 * alternatives, and teams can define their own in settings. Every framework says
 * which of its elements each request size needs, so small edits stay quick and
 * design questions get the full checklist.
 *
 * This file has no dependency on the `vscode` module so it can be unit tested.
 */

import type { RequestSize } from './triage';

export interface FrameworkElement {
	/** Stable id used in the checker's JSON, such as `parameters`. */
	readonly id: string;
	/** Display name, such as `Parameters`. */
	readonly label: string;
	/** What the element means, written to the developer as a phrase. Empty when a custom element has none. */
	readonly meaning: string;
	/** A short example for coding prompts. */
	readonly example?: string;
}

export interface Framework {
	/** Setting value, such as `maps` or `co-star`. */
	readonly id: string;
	/** Short name used in messages, such as `MAPS`. */
	readonly name: string;
	/** Name with attribution, used in pickers, such as `MAPS (Dan Martell)`. */
	readonly title: string;
	/** One line for pickers. */
	readonly summary: string;
	readonly source?: string;
	readonly elements: readonly FrameworkElement[];
	/** Element ids each request size needs, in element order. */
	readonly requiredBySize: Readonly<Record<RequestSize, readonly string[]>>;
	/** The element that names the task itself. Small requests need only this one. */
	readonly taskElement: string;
	/** Optional closing advice for /explain. */
	readonly note?: string;
}

export const SIZES: readonly RequestSize[] = ['small', 'task', 'large', 'design'];

export const MAPS: Framework = {
	id: 'maps',
	name: 'MAPS',
	title: 'MAPS (Dan Martell)',
	summary: 'Mission, Ask, Parameters, Shape. The default.',
	source: 'Dan Martell',
	elements: [
		{ id: 'mission', label: 'Mission', meaning: 'why you want this, the outcome that matters', example: 'so checkout stays under 200 ms at peak' },
		{ id: 'ask', label: 'Ask', meaning: 'the specific task or deliverable', example: 'add a read-through cache to `getProduct`' },
		{
			id: 'parameters',
			label: 'Parameters',
			meaning: "facts the AI can't guess, such as your stack, constraints, the files involved, scale, what must not change, or the exact error",
			example: 'Redis is already set up; product data changes hourly',
		},
		{
			id: 'shape',
			label: 'Shape',
			meaning: 'what the answer should look like, such as a plan, a diff, a short answer, or options with trade-offs',
			example: 'a short plan with trade-offs, no code yet',
		},
	],
	requiredBySize: {
		small: ['ask'],
		task: ['ask', 'parameters'],
		large: ['ask', 'parameters', 'shape'],
		design: ['mission', 'ask', 'parameters', 'shape'],
	},
	taskElement: 'ask',
	note: 'Missing **Parameters** is the usual cause of confident answers built on wrong guesses. Missing **Shape** is the usual cause of long answers that wander off topic.',
};

export const CO_STAR: Framework = {
	id: 'co-star',
	name: 'CO-STAR',
	title: 'CO-STAR',
	summary: "Context, Objective, Style, Tone, Audience, Response. From GovTech Singapore's Data Science & AI team.",
	source: "GovTech Singapore's Data Science & AI team, popularized by Sheila Teo",
	elements: [
		{ id: 'context', label: 'Context', meaning: "background the AI can't see, such as the situation, the constraints, and what you've already tried", example: 'the API times out under load since we added auth' },
		{ id: 'objective', label: 'Objective', meaning: 'the specific task', example: 'find why `/orders` slows down and propose a fix' },
		{ id: 'style', label: 'Style', meaning: 'conventions or approach to follow', example: 'match the existing repository pattern' },
		{ id: 'tone', label: 'Tone', meaning: 'the voice of the answer', example: 'terse, like a code review' },
		{ id: 'audience', label: 'Audience', meaning: 'who the result is for', example: 'a teammate new to the codebase' },
		{ id: 'response', label: 'Response', meaning: 'the form of the answer', example: 'a diff plus a two-line summary' },
	],
	requiredBySize: {
		small: ['objective'],
		task: ['context', 'objective'],
		large: ['context', 'objective', 'response'],
		design: ['context', 'objective', 'audience', 'response'],
	},
	taskElement: 'objective',
	note: 'For coding prompts, **Style** and **Tone** are optional: add them when they matter.',
};

export const RISEN: Framework = {
	id: 'risen',
	name: 'RISEN',
	title: 'RISEN (Kyle Balmer)',
	summary: 'Role, Instructions, Steps, End goal, Narrowing.',
	source: 'Kyle Balmer',
	elements: [
		{ id: 'role', label: 'Role', meaning: 'the expertise the AI should bring', example: 'as a senior backend engineer' },
		{ id: 'instructions', label: 'Instructions', meaning: 'the main task', example: 'add rate limiting to the public API' },
		{ id: 'steps', label: 'Steps', meaning: 'the approach or order of work to follow', example: 'add the middleware, then tests, then docs' },
		{ id: 'end-goal', label: 'End goal', meaning: 'what success looks like', example: 'no client can exceed 100 requests a minute' },
		{
			id: 'narrowing',
			label: 'Narrowing',
			meaning: "constraints and limits, such as what to avoid, what must not change, and the scope",
			example: "don't add new dependencies; keep the public API unchanged",
		},
	],
	requiredBySize: {
		small: ['instructions'],
		task: ['instructions', 'narrowing'],
		large: ['instructions', 'end-goal', 'narrowing'],
		design: ['instructions', 'end-goal', 'narrowing'],
	},
	taskElement: 'instructions',
	note: '**Role** and **Steps** are optional for coding prompts: add a role when you want a particular point of view, and steps when the order of work matters.',
};

export const RTF: Framework = {
	id: 'rtf',
	name: 'RTF',
	title: 'RTF',
	summary: 'Role, Task, Format. The lightest checklist.',
	elements: [
		{ id: 'role', label: 'Role', meaning: 'the expertise the AI should bring', example: 'as a security reviewer' },
		{ id: 'task', label: 'Task', meaning: 'the specific job to do', example: 'review the login handler for injection risks' },
		{ id: 'format', label: 'Format', meaning: 'the form of the answer', example: 'a numbered list, most severe first' },
	],
	requiredBySize: {
		small: ['task'],
		task: ['task'],
		large: ['task', 'format'],
		design: ['task', 'format'],
	},
	taskElement: 'task',
	note: '**Role** is optional for coding prompts; add one when you want a particular point of view.',
};

export const BUILT_IN_FRAMEWORKS: readonly Framework[] = [MAPS, CO_STAR, RISEN, RTF];

export const DEFAULT_FRAMEWORK = MAPS;

/** The setting value that selects the custom framework. */
export const CUSTOM_FRAMEWORK_ID = 'custom';

export function findBuiltInFramework(id: string): Framework | undefined {
	return BUILT_IN_FRAMEWORKS.find(f => f.id === id);
}

/** Element ids in the order the framework lists them, without duplicates or unknown ids. */
export function orderElements(framework: Pick<Framework, 'elements'>, ids: Iterable<string>): string[] {
	const wanted = new Set(ids);
	return framework.elements.filter(e => wanted.has(e.id)).map(e => e.id);
}

export function elementLabel(framework: Pick<Framework, 'elements'>, id: string): string {
	return framework.elements.find(e => e.id === id)?.label ?? id;
}

/**
 * Maps a checker's answer ("Parameters", "end goal", "end-goal") to an element
 * id: an exact id first, then a loosely matching id, then a matching label.
 */
export function resolveElementId(framework: Pick<Framework, 'elements'>, value: string): string | undefined {
	const elements = framework.elements;
	const exact = elements.find(e => e.id === value.trim());
	if (exact) {
		return exact.id;
	}
	const key = normalizeKey(value);
	return (elements.find(e => normalizeKey(e.id) === key) ?? elements.find(e => normalizeKey(e.label) === key))?.id;
}

function normalizeKey(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// ---------------------------------------------------------------- custom frameworks

/** The shape of the `checkTheMaps.customFramework` setting. */
export interface CustomFrameworkSetting {
	name?: unknown;
	elements?: unknown;
	requiredBySize?: unknown;
	taskElement?: unknown;
}

export interface CustomFrameworkResult {
	/** Present when the setting describes a usable framework. */
	readonly framework?: Framework;
	/** Problems that made the setting unusable, or that were worked around. */
	readonly problems: readonly string[];
}

const MAX_ELEMENTS = 8;

function slug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
}

/** Labels that usually name the task itself, used to pick a default task element. */
const TASK_LIKE = new Set(['task', 'ask', 'objective', 'instructions', 'instruction', 'request', 'change', 'action', 'what']);

/**
 * Builds a framework from the custom setting. Missing pieces get sensible
 * defaults; anything that can't be used is reported in `problems`.
 */
export function parseCustomFramework(setting: unknown): CustomFrameworkResult {
	const problems: string[] = [];
	if (!setting || typeof setting !== 'object' || Array.isArray(setting)) {
		return { problems: ['checkTheMaps.customFramework is empty. Add a name and a list of elements.'] };
	}
	const raw = setting as CustomFrameworkSetting;

	const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : 'Custom';

	if (!Array.isArray(raw.elements) || raw.elements.length === 0) {
		return { problems: ['checkTheMaps.customFramework needs at least one element.'] };
	}

	const elements: FrameworkElement[] = [];
	const keys = new Map<string, string>(); // normalized id or label -> label that claimed it
	raw.elements.slice(0, MAX_ELEMENTS).forEach((item, index) => {
		if (typeof item === 'string' && item.trim()) {
			item = { label: item };
		}
		const element = item as { id?: unknown; label?: unknown; meaning?: unknown; example?: unknown };
		const label = typeof element?.label === 'string' ? element.label.trim().slice(0, 40) : '';
		if (!label) {
			problems.push(`Element ${index + 1} has no label, so it was skipped.`);
			return;
		}
		const id = typeof element.id === 'string' && slug(element.id) ? slug(element.id) : slug(label);
		if (!id) {
			problems.push(`Element "${label}" needs an id made of letters or numbers, so it was skipped.`);
			return;
		}
		// The checker may answer with an id or a label, so both must be unambiguous.
		const clash = [normalizeKey(id), normalizeKey(label)].map(key => keys.get(key)).find(Boolean);
		if (clash) {
			problems.push(`Element "${label}" is too similar to "${clash}", so it was skipped. Give it a different id and label.`);
			return;
		}
		keys.set(normalizeKey(id), label);
		keys.set(normalizeKey(label), label);
		elements.push({
			id,
			label,
			meaning: typeof element.meaning === 'string' ? element.meaning.trim().slice(0, 300) : '',
			example: typeof element.example === 'string' && element.example.trim() ? element.example.trim().slice(0, 200) : undefined,
		});
	});
	if (raw.elements.length > MAX_ELEMENTS) {
		problems.push(`Only the first ${MAX_ELEMENTS} elements are used.`);
	}
	if (elements.length === 0) {
		return { problems: [...problems, 'checkTheMaps.customFramework has no usable elements.'] };
	}

	const lookup = (value: unknown): string | undefined =>
		typeof value === 'string' ? resolveElementId({ elements }, value) : undefined;

	let requested: Record<string, unknown> = {};
	if (raw.requiredBySize !== undefined) {
		if (raw.requiredBySize && typeof raw.requiredBySize === 'object' && !Array.isArray(raw.requiredBySize)) {
			requested = raw.requiredBySize as Record<string, unknown>;
		} else {
			problems.push('requiredBySize should be an object with "task", "large" and "design" lists, so defaults are used.');
		}
	}
	const partial: Partial<Record<RequestSize, string[]>> = {};
	for (const size of SIZES) {
		const list = requested[size];
		if (list === undefined) {
			continue;
		}
		if (!Array.isArray(list)) {
			problems.push(`requiredBySize.${size} should be a list of element ids.`);
			continue;
		}
		const resolved: string[] = [];
		for (const value of list) {
			const id = lookup(value);
			if (id) {
				resolved.push(id);
			} else {
				problems.push(`requiredBySize.${size} mentions "${String(value)}", which isn't one of the elements.`);
			}
		}
		partial[size] = resolved;
	}

	// The task element: as named, else the first "small" entry, else a task-like label, else the first element.
	const named = lookup(raw.taskElement);
	const guessed =
		partial.small?.[0] ??
		elements.find(e => TASK_LIKE.has(normalizeKey(e.id)) || TASK_LIKE.has(normalizeKey(e.label)))?.id ??
		elements[0].id;
	const task = named ?? guessed;
	if (raw.taskElement !== undefined && !named) {
		problems.push(
			`taskElement "${String(raw.taskElement)}" isn't one of the elements, so "${elementLabel({ elements }, task)}" is used.`,
		);
	}
	if (partial.small && (partial.small.length > 1 || (partial.small.length === 1 && partial.small[0] !== task))) {
		problems.push(
			`Small requests only check the task element ("${elementLabel({ elements }, task)}"), so requiredBySize.small is ignored.`,
		);
	}

	// Defaults grow with the request: the task element first, then the others in order.
	// The task element is always needed: a request that doesn't say what to do can't pass.
	const allIds = elements.map(e => e.id);
	const others = allIds.filter(id => id !== task);
	const shape = { elements };
	const requiredBySize: Record<RequestSize, string[]> = {
		// Small requests need only the task element, so they stay quick.
		small: [task],
		task: orderElements(shape, [task, ...(partial.task ?? others.slice(0, 1))]),
		large: orderElements(shape, [task, ...(partial.large ?? others.slice(0, 2))]),
		design: orderElements(shape, [task, ...(partial.design ?? others)]),
	};

	return {
		framework: {
			id: CUSTOM_FRAMEWORK_ID,
			name,
			title: `${name} (custom)`,
			summary: elements.map(e => e.label).join(', '),
			elements,
			requiredBySize,
			taskElement: task,
		},
		problems,
	};
}

/** The parts of `WorkspaceConfiguration.inspect()` that matter for choosing a value. */
export interface InspectedSetting<T> {
	readonly defaultValue?: T;
	readonly globalValue?: T;
	readonly workspaceValue?: T;
}

/**
 * The value that should win, taken whole. VS Code merges object settings across
 * user and workspace, which would mix two different custom frameworks into one.
 * In an untrusted workspace, workspace values are ignored.
 */
export function effectiveSettingValue<T>(inspected: InspectedSetting<T> | undefined, workspaceTrusted: boolean): T | undefined {
	if (!inspected) {
		return undefined;
	}
	if (workspaceTrusted && inspected.workspaceValue !== undefined) {
		return inspected.workspaceValue;
	}
	return inspected.globalValue ?? inspected.defaultValue;
}

export interface FrameworkChoice {
	readonly framework: Framework;
	/** Set when the requested framework couldn't be used and the default was. */
	readonly problems: readonly string[];
}

/** Resolves the framework setting, falling back to MAPS with an explanation. */
export function resolveFramework(id: string, customSetting: unknown): FrameworkChoice {
	if (id === CUSTOM_FRAMEWORK_ID) {
		const custom = parseCustomFramework(customSetting);
		if (custom.framework) {
			return { framework: custom.framework, problems: custom.problems };
		}
		return { framework: DEFAULT_FRAMEWORK, problems: [...custom.problems, 'Using MAPS until the custom framework is fixed.'] };
	}
	const builtIn = findBuiltInFramework(id);
	if (builtIn) {
		return { framework: builtIn, problems: [] };
	}
	return { framework: DEFAULT_FRAMEWORK, problems: [`"${id}" isn't a known framework, so MAPS is used.`] };
}
