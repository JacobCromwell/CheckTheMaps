import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { escapeMarkdown, fence, joinLabels, mapsChecklist } from '../src/messages';

describe('messages', () => {
	it('joins MAPS labels naturally', () => {
		assert.equal(joinLabels([]), '');
		assert.equal(joinLabels(['shape']), 'Shape');
		assert.equal(joinLabels(['parameters', 'shape']), 'Parameters and Shape');
		assert.equal(joinLabels(['mission', 'parameters', 'shape']), 'Mission, Parameters and Shape');
	});

	it('shows only the elements a size needs', () => {
		assert.equal(mapsChecklist('task', ['parameters']), 'For a task: Ask ✓ · Parameters ✗');
		assert.equal(
			mapsChecklist('design', ['mission', 'shape']),
			'For a design question: Mission ✗ · Ask ✓ · Parameters ✓ · Shape ✗',
		);
		assert.equal(mapsChecklist('small', []), 'For a small request: Ask ✓');
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
});
