import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CO_STAR, MAPS } from '../src/core/frameworks';
import {
	DamagedSectionError,
	SECTION_END,
	buildGuidance,
	currentSection,
	hasSection,
	removeSection,
	sectionFrameworkId,
	sectionState,
	startMarker,
	upsertSection,
} from '../src/core/instructions';

describe('instructions guidance', () => {
	it('describes the framework and scales by size', () => {
		const text = buildGuidance(MAPS);
		assert.ok(text.startsWith(startMarker(MAPS)));
		assert.ok(text.endsWith(SECTION_END));
		assert.match(text, /## Prompt clarity \(MAPS\)/);
		assert.match(text, /- \*\*Parameters\*\*: facts the AI can't guess/);
		assert.match(text, /- Small, specific edits or questions \(rename a function, fix this error\): just do them\./);
		assert.match(text, /- Design, architecture and technology questions: make sure you have Mission, Ask, Parameters and Shape\./);
		assert.match(text, /ask at most two short, specific questions/);
	});

	it('follows the selected framework and records it in the marker', () => {
		const text = buildGuidance(CO_STAR);
		assert.match(text, /Context, Objective, Audience and Response/);
		assert.equal(sectionFrameworkId(text), 'co-star');
	});

	it('appends to a new or existing file', () => {
		const section = buildGuidance(MAPS);
		assert.equal(upsertSection('', section), `${section}\n`);
		assert.equal(upsertSection('# Our rules\n\nUse tabs.\n\n\n', section), `# Our rules\n\nUse tabs.\n\n${section}\n`);
	});

	it('replaces its own section in place and is idempotent', () => {
		const original = `# Rules\n\n${buildGuidance(MAPS)}\n\n## More rules\nKeep it short.\n`;
		const updated = upsertSection(original, buildGuidance(CO_STAR));
		assert.ok(updated.startsWith('# Rules\n\n'));
		assert.ok(updated.endsWith('\n\n## More rules\nKeep it short.\n'));
		assert.match(updated, /CO-STAR/);
		assert.doesNotMatch(updated, /\(MAPS\)/);
		assert.equal(upsertSection(updated, buildGuidance(CO_STAR)), updated);
		assert.equal(currentSection(updated), buildGuidance(CO_STAR));
	});

	it('keeps Windows line endings', () => {
		const crlf = '# Rules\r\n\r\nUse tabs.\r\n';
		const added = upsertSection(crlf, buildGuidance(MAPS));
		assert.ok(!/[^\r]\n/.test(added), 'no bare LF');
		assert.equal(currentSection(added), buildGuidance(MAPS));
		const removed = removeSection(added);
		assert.equal(removed, '# Rules\r\n\r\nUse tabs.\r\n');
	});

	it('removes only its own section', () => {
		const file = `# Rules\n\n${buildGuidance(MAPS)}\n\n## More rules\nKeep it short.\n`;
		assert.equal(removeSection(file), '# Rules\n\n## More rules\nKeep it short.\n');
		assert.equal(removeSection(`${buildGuidance(MAPS)}\n`), '');
		assert.equal(removeSection('# Rules\n'), '# Rules\n');
		assert.ok(hasSection(file));
		assert.ok(!hasSection('# Rules\n'));
	});

	it('refuses to edit damaged markers instead of duplicating the section', () => {
		const section = buildGuidance(MAPS);
		const damaged = [
			section.replace(SECTION_END, ''), // missing end
			`${section}\n${section}`, // duplicated
			`${SECTION_END}\n${startMarker(MAPS)}`, // reversed
		];
		for (const text of damaged) {
			assert.equal(sectionState(text), 'damaged');
			assert.throws(() => upsertSection(text, section), DamagedSectionError);
			assert.throws(() => removeSection(text), DamagedSectionError);
		}
	});
});
