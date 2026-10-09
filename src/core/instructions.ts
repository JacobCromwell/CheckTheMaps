/**
 * Guidance for Copilot's own instructions file.
 *
 * `@maps` checks a prompt before Copilot sees it. This guidance works from the
 * other side: written into `.github/copilot-instructions.md` (or `AGENTS.md`), it
 * asks the agent itself to notice missing essentials, ask briefly instead of
 * guessing, and keep its answers in scope. It runs on the developer's chat model
 * and the model may not follow it, so it complements the check rather than
 * replacing it.
 *
 * The section sits between markers so it can be updated or removed later
 * without touching anything else in the file.
 *
 * This file has no dependency on the `vscode` module so it can be unit tested.
 */

import { SIZES, elementLabel, type Framework } from './frameworks';
import type { RequestSize } from './triage';

/** Start marker prefix; the full marker also records the framework id. */
export const SECTION_START_PREFIX = '<!-- check-the-maps:start';
export const SECTION_END = '<!-- check-the-maps:end -->';

export function startMarker(framework: Pick<Framework, 'id'>): string {
	return `${SECTION_START_PREFIX} framework="${framework.id}" -->`;
}

const SIZE_PHRASES: Record<RequestSize, string> = {
	small: 'Small, specific edits or questions (rename a function, fix this error)',
	task: 'Bug fixes and features in existing code',
	large: 'Multi-file refactors and migrations',
	design: 'Design, architecture and technology questions',
};

function joinLabels(framework: Framework, ids: readonly string[]): string {
	const labels = ids.map(id => elementLabel(framework, id));
	if (labels.length <= 1) {
		return labels.join('');
	}
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function sentence(text: string): string {
	return `${text.trim().replace(/[.\s]+$/, '')}.`;
}

/** The marked section to write into an instructions file. */
export function buildGuidance(framework: Framework): string {
	const elements = framework.elements.map(e => `- **${e.label}**${e.meaning ? `: ${sentence(e.meaning)}` : ''}`).join('\n');
	const sizes = SIZES.map(size => {
		const needs = framework.requiredBySize[size];
		const what = size === 'small' ? 'just do them' : `make sure you have ${joinLabels(framework, needs)}`;
		return `- ${SIZE_PHRASES[size]}: ${what}.`;
	}).join('\n');

	return `${startMarker(framework)}
## Prompt clarity (${framework.name})

<!-- Added by the Check The MAPS extension. Run "Check The MAPS: Add Guidance to Copilot Instructions" to update or remove it. -->

Before starting a request, check whether the developer has given you what you need, using ${framework.name}. These descriptions are written to the developer, so "you" in them means the developer:

${elements}

Scale this to the size of the request:

${sizes}

If something essential is missing, ask at most two short, specific questions before doing substantial work. Don't ask about anything you can find in the code or safely assume; state those assumptions in one line instead.

Keep answers to what was asked. Follow the requested format, and don't add loosely related suggestions unless asked. When you aren't sure, say so rather than guessing.
${SECTION_END}`;
}

export type SectionState = 'none' | 'ok' | 'damaged';

function count(content: string, marker: string): number {
	return content.split(marker).length - 1;
}

/** Whether the file has one well-formed section, none, or markers we shouldn't touch. */
export function sectionState(content: string): SectionState {
	const starts = count(content, SECTION_START_PREFIX);
	const ends = count(content, SECTION_END);
	if (starts === 0 && ends === 0) {
		return 'none';
	}
	if (starts === 1 && ends === 1 && content.indexOf(SECTION_START_PREFIX) < content.indexOf(SECTION_END)) {
		return 'ok';
	}
	return 'damaged';
}

/** True when the file already has a Check The MAPS section (well-formed or not). */
export function hasSection(content: string): boolean {
	return sectionState(content) !== 'none';
}

/** The framework id recorded in the section's start marker. */
export function sectionFrameworkId(content: string): string | undefined {
	return /<!-- check-the-maps:start framework="([^"]*)" -->/.exec(content)?.[1];
}

/** The section text, with line endings normalized, for comparing against fresh guidance. */
export function currentSection(content: string): string | undefined {
	const text = toLf(content);
	const bounds = sectionBounds(text);
	return bounds ? text.slice(bounds.start, bounds.end) : undefined;
}

export class DamagedSectionError extends Error {
	constructor() {
		super('The Check The MAPS markers in this file are missing or duplicated. Fix or remove them by hand, then try again.');
	}
}

function toLf(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

/** Converts LF text back to the line endings the original file used. */
function withEol(text: string, original: string): string {
	return original.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
}

function sectionBounds(content: string): { start: number; end: number } | undefined {
	if (sectionState(content) !== 'ok') {
		return undefined;
	}
	const start = content.indexOf(SECTION_START_PREFIX);
	return { start, end: content.indexOf(SECTION_END) + SECTION_END.length };
}

/** Replaces the existing section, or appends one after the current content. Keeps the file's line endings. */
export function upsertSection(content: string, section: string): string {
	if (sectionState(content) === 'damaged') {
		throw new DamagedSectionError();
	}
	const text = toLf(content);
	const bounds = sectionBounds(text);
	let result: string;
	if (bounds) {
		result = text.slice(0, bounds.start) + toLf(section) + text.slice(bounds.end);
	} else {
		const trimmed = text.replace(/\s+$/, '');
		result = trimmed ? `${trimmed}\n\n${toLf(section)}\n` : `${toLf(section)}\n`;
	}
	return withEol(result, content);
}

/** Removes the section and the blank lines around it, leaving the rest of the file as it was. */
export function removeSection(content: string): string {
	if (sectionState(content) === 'damaged') {
		throw new DamagedSectionError();
	}
	const text = toLf(content);
	const bounds = sectionBounds(text);
	if (!bounds) {
		return content;
	}
	const before = text.slice(0, bounds.start).replace(/\s+$/, '');
	const after = text.slice(bounds.end).replace(/^\s+/, '');
	let result: string;
	if (!before) {
		result = after;
	} else {
		result = after ? `${before}\n\n${after}` : `${before}\n`;
	}
	return withEol(result, content);
}
