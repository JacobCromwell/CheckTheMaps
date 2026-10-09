import './support/stubVscode';

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { buildGuidance } from '../src/core/instructions';
import { CO_STAR, MAPS } from '../src/core/frameworks';
import {
	chooseFramework,
	currentFramework,
	manageInstructionsGuidance,
	reportFrameworkProblems,
} from '../src/frameworkCommands';
import * as stub from './support/vscode';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const g = (key: string) => stub.settings.global.get(`checkTheMaps.${key}`);
const w = (key: string) => stub.settings.workspace.get(`checkTheMaps.${key}`);
const commands = () => stub.recorder.calls.map(c => c.command);

describe('chooseFramework', () => {
	beforeEach(() => stub.recorder.reset());

	it('switches the framework in user settings and announces it once', async () => {
		stub.recorder.quickPicks.push(stub.pick('CO-STAR'));
		await chooseFramework('checkTheMaps.explain');
		await flush();
		assert.equal(g('framework'), 'co-star');
		assert.equal(currentFramework().framework, CO_STAR);
		assert.deepEqual(stub.recorder.messages, ['Prompts are now checked against CO-STAR.']);
	});

	it('marks the configured framework, even when a broken custom one fell back to MAPS', async () => {
		stub.settings.global.set('checkTheMaps.framework', 'custom');
		stub.settings.global.set('checkTheMaps.customFramework', { elements: [] });
		assert.equal(currentFramework().framework, MAPS);
		stub.recorder.quickPicks.push(stub.pick('MAPS'));
		await chooseFramework('checkTheMaps.explain');
		const offered = stub.recorder.offered[0];
		assert.ok(!offered.some(label => label.includes('MAPS') && label.includes('$(check)')), 'MAPS is not marked');
		assert.ok(offered.some(label => label.includes('Edit your custom framework')), 'offers to fix it, not overwrite it');
		// Choosing MAPS really switches away from the broken custom framework.
		assert.equal(g('framework'), 'maps');
	});

	it('asks before changing a framework the workspace chooses', async () => {
		stub.settings.workspace.set('checkTheMaps.framework', 'maps');
		stub.recorder.quickPicks.push(stub.pick('RISEN'));
		stub.recorder.buttons.push(undefined); // cancel the confirmation
		await chooseFramework('checkTheMaps.explain');
		assert.equal(w('framework'), 'maps');
		assert.equal(g('framework'), undefined);

		stub.recorder.quickPicks.push(stub.pick('RISEN'));
		stub.recorder.buttons.push('Change for the Workspace');
		await chooseFramework('checkTheMaps.explain');
		assert.equal(w('framework'), 'risen');
		assert.equal(g('framework'), undefined);
	});

	it('creates a starter custom framework and opens it', async () => {
		stub.recorder.quickPicks.push(stub.pick('Define your own'));
		await chooseFramework('checkTheMaps.explain');
		assert.equal(g('framework'), 'custom');
		assert.equal(currentFramework().framework.name, 'Our checklist');
		assert.deepEqual(stub.recorder.calls.at(-1), {
			command: 'workbench.action.openSettingsJson',
			args: [{ revealSetting: { key: 'checkTheMaps.customFramework' } }],
		});
	});

	it('opens an existing custom framework instead of overwriting it', async () => {
		const mine = { name: 'Mine', elements: ['Goal', 'Task'] };
		stub.settings.workspace.set('checkTheMaps.customFramework', mine);
		stub.recorder.quickPicks.push(stub.pick('Edit your custom framework'));
		await chooseFramework('checkTheMaps.explain');
		assert.equal(w('customFramework'), mine);
		assert.deepEqual(commands(), ['workbench.action.openWorkspaceSettingsFile']);
	});

	it('ignores workspace frameworks in Restricted Mode', () => {
		stub.settings.global.set('checkTheMaps.customFramework', { name: 'Mine', elements: ['Task'] });
		stub.settings.workspace.set('checkTheMaps.customFramework', { name: 'Theirs', elements: ['Task'] });
		stub.settings.global.set('checkTheMaps.framework', 'custom');
		assert.equal(currentFramework().framework.name, 'Theirs');
		stub.workspace.isTrusted = false;
		assert.equal(currentFramework().framework.name, 'Mine');
	});
});

describe('reportFrameworkProblems', () => {
	beforeEach(() => stub.recorder.reset());

	it('opens the custom framework when that is what is broken, and warns once', async () => {
		stub.settings.global.set('checkTheMaps.framework', 'custom');
		stub.recorder.buttons.push('Fix It');
		reportFrameworkProblems(['Problem A.'], () => undefined);
		reportFrameworkProblems(['Problem A.'], () => undefined);
		await flush();
		assert.equal(stub.recorder.messages.length, 1);
		assert.deepEqual(stub.recorder.calls[0].args, [{ revealSetting: { key: 'checkTheMaps.customFramework' } }]);
	});
});

describe('manageInstructionsGuidance', () => {
	const folder = { uri: stub.Uri.parse('file:///workspace'), name: 'workspace', index: 0 };
	const instructions = 'file:///workspace/.github/copilot-instructions.md';

	beforeEach(() => {
		stub.recorder.reset();
		stub.workspace.workspaceFolders = [folder];
	});

	it('needs an open folder', async () => {
		stub.workspace.workspaceFolders = undefined;
		await manageInstructionsGuidance();
		assert.match(stub.recorder.messages[0], /Open a folder first/);
	});

	it('adds guidance to the chosen file, then updates or removes it', async () => {
		stub.files.set(instructions, '# Team rules\n\nUse tabs.\n');
		stub.recorder.quickPicks.push(stub.pick('copilot-instructions'));
		await manageInstructionsGuidance();
		assert.equal(stub.files.get(instructions), `# Team rules\n\nUse tabs.\n\n${buildGuidance(MAPS)}\n`);

		stub.settings.global.set('checkTheMaps.framework', 'co-star');
		stub.recorder.quickPicks.push(stub.pick('Update to CO-STAR'));
		await manageInstructionsGuidance();
		assert.equal(stub.files.get(instructions), `# Team rules\n\nUse tabs.\n\n${buildGuidance(CO_STAR)}\n`);

		stub.recorder.quickPicks.push(stub.pick('Remove'));
		await manageInstructionsGuidance();
		assert.equal(stub.files.get(instructions), '# Team rules\n\nUse tabs.\n');
	});

	it('deletes a file it created once the guidance is removed', async () => {
		stub.recorder.quickPicks.push(stub.pick('AGENTS.md'));
		await manageInstructionsGuidance();
		assert.ok(stub.files.has('file:///workspace/AGENTS.md'));
		stub.recorder.quickPicks.push(stub.pick('Remove'));
		await manageInstructionsGuidance();
		assert.ok(!stub.files.has('file:///workspace/AGENTS.md'));
	});

	it('leaves damaged markers alone and says so', async () => {
		const damaged = `${buildGuidance(MAPS)}\n${buildGuidance(MAPS)}\n`;
		stub.files.set(instructions, damaged);
		stub.recorder.quickPicks.push(stub.pick('Update'));
		await manageInstructionsGuidance();
		assert.equal(stub.files.get(instructions), damaged);
		assert.match(stub.recorder.messages.join('\n'), /markers in this file are missing or duplicated/);
	});

	it('offers to update guidance after a framework change', async () => {
		stub.files.set(instructions, `${buildGuidance(MAPS)}\n`);
		stub.recorder.quickPicks.push(stub.pick('RTF'));
		stub.recorder.buttons.push('Update Guidance');
		await chooseFramework('checkTheMaps.explain');
		await flush();
		await flush();
		assert.match(stub.recorder.messages[0], /doesn't match RTF/);
		assert.match(stub.files.get(instructions) ?? '', /Prompt clarity \(RTF\)/);
	});
});
