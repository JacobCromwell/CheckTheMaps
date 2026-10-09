import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CO_STAR, MAPS, RISEN, parseCustomFramework } from '../src/core/frameworks';
import { checklist, escapeMarkdown, explain, fence, help, joinLabels, sentence } from '../src/messages';

describe('messages', () => {
	it('joins MAPS labels naturally', () => {
		assert.equal(joinLabels(MAPS, []), '');
		assert.equal(joinLabels(MAPS, ['shape']), 'Shape');
		assert.equal(joinLabels(MAPS, ['parameters', 'shape']), 'Parameters and Shape');
		assert.equal(joinLabels(MAPS, ['mission', 'parameters', 'shape']), 'Mission, Parameters and Shape');
	});

	it('shows only the elements a size needs', () => {
		assert.equal(checklist(MAPS, 'task', ['parameters']), 'For a task: Ask ✓ · Parameters ✗');
		assert.equal(
			checklist(MAPS, 'design', ['mission', 'shape']),
			'For a design question: Mission ✗ · Ask ✓ · Parameters ✓ · Shape ✗',
		);
		assert.equal(checklist(MAPS, 'small', []), 'For a small request: Ask ✓');
	});

	it('fences text that contains backticks', () => {
		const text = 'use ```js blocks``` here';
		const fenced = fence(text);
		assert.ok(fenced.startsWith('````text\n'));
		assert.ok(fenced.endsWith('\n````'));
		assert.equal(fence('plain'), '```text\nplain\n```');
	});

	it('escapes links and HTML but keeps inline code', () => {
		assert.equal(escapeMarkdown('see [this](http://x) <b>now</b> `code`'), 'see \\[this\\](http://x) \\<b\\>now\\</b\\> `code`');
	});

	it('uses the active framework for checklists and labels', () => {
		assert.equal(checklist(CO_STAR, 'large', ['response']), 'For a multi-file change: Context ✓ · Objective ✓ · Response ✗');
		assert.equal(joinLabels(RISEN, ['end-goal', 'narrowing']), 'End goal and Narrowing');
	});

	it('explains each framework, with its sizes and notes', () => {
		const text = explain(CO_STAR);
		assert.match(text, /\*\*CO-STAR\*\* \(GovTech Singapore's Data Science & AI team/);
		assert.match(text, /- \*\*Context\*\*: background/);
		assert.match(text, /\| Design, architecture or technology choice \| Context, Objective, Audience, Response \|/);
		assert.match(text, /Style\*\* and \*\*Tone\*\* are optional/);
		assert.match(explain(MAPS), /4-part checklist/);
	});

	it('renders parts with only an example, or nothing at all', () => {
		const f = parseCustomFramework({ elements: [{ label: 'Goal', example: 'ship it.' }, 'Task'] }).framework!;
		const text = explain(f);
		assert.match(text, /- \*\*Goal\*\*: For example: _ship it_\./);
		assert.match(text, /- \*\*Task\*\*\n/);
	});

	it('names the framework in the help text', () => {
		assert.match(help(RISEN), /checks your prompt against RISEN/);
	});

	it('ends sentences with exactly one period', () => {
		assert.equal(sentence('done.'), 'done.');
		assert.equal(sentence('done  '), 'done.');
	});
});
