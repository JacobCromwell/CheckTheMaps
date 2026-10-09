import './support/stubVscode';

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type * as vscodeTypes from 'vscode';
import type { StatsEvent } from '../src/core/stats';
import {
	createFollowupProvider,
	createHandler,
	type HandlerDeps,
	type HandOffRequest,
	type ResultMetadata,
	type Settings,
	type StatusState,
} from '../src/participant';
import * as stub from './support/vscode';

// ---------------------------------------------------------------- fakes

interface Recorded {
	markdown: string[];
	progress: string[];
	buttons: { title: string; command: string; args: unknown[] }[];
	handOffs: HandOffRequest[];
	events: StatsEvent[];
	costs: number[];
	statuses: StatusState[];
	modelPrompts: string[];
	logs: string[];
}

type ModelBehavior = string | Error | 'hang';

function fakeModel(behavior: () => ModelBehavior, record: Recorded): vscodeTypes.LanguageModelChat {
	return {
		id: 'gpt-6-luna',
		name: 'GPT-6 Luna',
		vendor: 'copilot',
		family: 'gpt-6-luna',
		version: '1',
		maxInputTokens: 100_000,
		countTokens: async () => 0,
		sendRequest: async (messages: unknown[]) => {
			record.modelPrompts.push((messages[0] as { content: string }).content);
			const b = behavior();
			if (b instanceof Error) {
				throw b;
			}
			if (b === 'hang') {
				return { text: (async function* () { await new Promise(() => undefined); })(), stream: undefined };
			}
			return {
				text: (async function* () {
					// Stream in two chunks, like a real model.
					yield b.slice(0, 5);
					yield b.slice(5);
				})(),
				stream: undefined,
			};
		},
	} as unknown as vscodeTypes.LanguageModelChat;
}

function fakeStream(record: Recorded): vscodeTypes.ChatResponseStream {
	return {
		markdown: (value: string | { value: string }) => record.markdown.push(typeof value === 'string' ? value : value.value),
		progress: (value: string) => record.progress.push(value),
		button: (command: { title: string; command: string; arguments?: unknown[] }) =>
			record.buttons.push({ title: command.title, command: command.command, args: command.arguments ?? [] }),
		anchor: () => undefined,
		filetree: () => undefined,
		reference: () => undefined,
		push: () => undefined,
	} as unknown as vscodeTypes.ChatResponseStream;
}

function token(cancelled = false): vscodeTypes.CancellationToken {
	const source = new stub.CancellationTokenSource();
	if (cancelled) {
		source.cancel();
	}
	return source.token as unknown as vscodeTypes.CancellationToken;
}

interface Scenario {
	settings?: Partial<Settings>;
	model?: 'none' | 'throws' | (() => ModelBehavior);
	consent?: boolean | undefined;
	underLimit?: boolean;
	editor?: { activeFile?: string; activeFileErrors?: number; hasSelection?: boolean };
	modelNote?: string;
	/** Paths (under /workspace/) that are folders. */
	folders?: string[];
}

function setup(scenario: Scenario = {}) {
	const record: Recorded = {
		markdown: [],
		progress: [],
		buttons: [],
		handOffs: [],
		events: [],
		costs: [],
		statuses: [],
		modelPrompts: [],
		logs: [],
	};
	const settings: Settings = {
		strictness: 'lenient',
		autoSend: true,
		sendInMode: '',
		timeoutSeconds: 8,
		dailyCheckLimit: 300,
		...scenario.settings,
	};
	const behavior = scenario.model === 'none' || scenario.model === 'throws' ? undefined : scenario.model ?? (() => PASS_JSON);
	const model = behavior ? fakeModel(behavior, record) : undefined;
	const deps: HandlerDeps = {
		settings: () => settings,
		resolveModel: async () => {
			if (scenario.model === 'throws') {
				throw new Error('model service unavailable');
			}
			return model
				? { model, label: 'GPT-6 Luna', price: { key: 'gpt-6-luna', inputPerM: 0.1, outputPerM: 0.5 }, note: scenario.modelNote }
				: { note: 'No low-cost model is available.' };
		},
		canSendRequest: () => ('consent' in scenario ? scenario.consent : true),
		editorContext: () => ({ activeFileErrors: 0, hasSelection: false, ...scenario.editor }),
		relativePath: uri => uri.path.replace(/^\/workspace\//, ''),
		classifyUri: async uri => {
			if (uri.scheme !== 'file') {
				return 'unsupported';
			}
			return (scenario.folders ?? []).some(f => uri.path === `/workspace/${f}`) ? 'folder' : 'file';
		},
		underDailyLimit: () => scenario.underLimit ?? true,
		record: event => record.events.push(event),
		recordCost: usd => record.costs.push(usd),
		scheduleHandOff: request => {
			record.handOffs.push(request);
			return `id-${record.handOffs.length}`;
		},
		setStatus: state => record.statuses.push(state),
		log: message => record.logs.push(message),
	};
	return { record, handler: createHandler(deps) };
}

interface RequestOptions {
	command?: string;
	references?: vscodeTypes.ChatPromptReference[];
	history?: unknown[];
	cancelled?: boolean;
}

async function run(handler: ReturnType<typeof createHandler>, record: Recorded, prompt: string, options: RequestOptions = {}) {
	const request = {
		prompt,
		command: options.command,
		references: options.references ?? [],
		toolReferences: [],
		toolInvocationToken: undefined,
		model: undefined,
	} as unknown as vscodeTypes.ChatRequest;
	const context = { history: options.history ?? [] } as unknown as vscodeTypes.ChatContext;
	const result = (await handler(request, context, fakeStream(record), token(options.cancelled))) as vscodeTypes.ChatResult;
	return result.metadata as ResultMetadata;
}

const PASS_JSON = '{"size":"task","verdict":"pass","missing":[],"why":"Clear and scoped.","questions":[],"rewrite":""}';
const FLAG_JSON = JSON.stringify({
	size: 'design',
	verdict: 'improve',
	missing: ['parameters', 'shape'],
	why: 'No scale or output format given.',
	questions: ['How many users do you expect?', 'Do you want a diagram or a written plan?'],
	rewrite: 'Design a caching layer for [service] handling [expected load]. Give a short written plan.',
});

const allText = (record: Recorded) => record.markdown.join('\n');

// ---------------------------------------------------------------- tests

describe('participant: basics', () => {
	it('shows help for an empty prompt', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, '   ');
		assert.equal(meta.outcome, 'help');
		assert.match(allText(record), /Type your request after `@maps`/);
		assert.equal(record.handOffs.length, 0);
	});

	it('explains MAPS without a model call', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, '', { command: 'explain' });
		assert.equal(meta.outcome, 'explain');
		assert.match(allText(record), /\*\*Mission\*\*/);
		assert.equal(record.modelPrompts.length, 0);
	});

	it('/send skips the check', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, 'design our whole platform', { command: 'send' });
		assert.equal(meta.outcome, 'sent');
		assert.equal(record.modelPrompts.length, 0);
		assert.equal(record.handOffs[0].reason, 'skipCheck');
		assert.equal(record.handOffs[0].submit, true);
		assert.equal(meta.handOffId, 'id-1');
	});

	it('/send still sends when automatic sending is off', async () => {
		const { record, handler } = setup({ settings: { autoSend: false } });
		await run(handler, record, 'anything at all', { command: 'send' });
		assert.equal(record.handOffs.length, 1);
	});
});

describe('participant: passing prompts', () => {
	it('passes small prompts locally and hands them off, with no model call', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, 'rename the function helloWorld to helloDolly');
		assert.deepEqual(meta, { outcome: 'passed', size: 'small', source: 'local', handOffId: 'id-1' });
		assert.equal(record.modelPrompts.length, 0);
		assert.equal(record.handOffs.length, 1);
		assert.deepEqual(record.handOffs[0], {
			prompt: 'rename the function helloWorld to helloDolly',
			submit: true,
			mode: undefined,
			files: [],
			folders: [],
			reason: 'passed',
		});
		assert.match(allText(record), /✅ Looks good\. Sent to Copilot\./);
		assert.match(allText(record), /command:checkTheMaps\.resend/);
		assert.deepEqual(record.events, ['passedLocally']);
		assert.deepEqual(record.statuses, ['passed']);
	});

	it('passes prompts the model approves and records the cost', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, 'add caching to the user lookup so repeated calls are faster');
		assert.deepEqual(meta, { outcome: 'passed', size: 'task', source: 'model', handOffId: 'id-1' });
		assert.equal(record.modelPrompts.length, 1);
		assert.equal(record.handOffs.length, 1);
		assert.deepEqual(record.events, ['modelChecks', 'passedByModel']);
		assert.equal(record.costs.length, 1);
		assert.ok(record.costs[0] > 0 && record.costs[0] < 0.001);
		assert.deepEqual(record.statuses, ['checking', 'passed']);
	});

	it('sends in the configured mode', async () => {
		const { record, handler } = setup({ settings: { sendInMode: 'agent' } });
		await run(handler, record, 'rename helloWorld to helloDolly');
		assert.equal(record.handOffs[0].mode, 'agent');
	});

	it('offers a button instead of sending when auto-send is off', async () => {
		const { record, handler } = setup({ settings: { autoSend: false } });
		await run(handler, record, 'rename helloWorld to helloDolly');
		assert.equal(record.handOffs.length, 0);
		assert.equal(record.buttons[0].title, 'Send to Copilot');
		assert.equal((record.buttons[0].args[0] as HandOffRequest).submit, true);
	});

	it('/check reports a pass without sending', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, 'rename helloWorld to helloDolly', { command: 'check' });
		assert.equal(meta.outcome, 'passed');
		assert.equal(record.handOffs.length, 0);
		assert.match(allText(record), /✅ \*\*Passes MAPS\.\*\* For a small request: Ask ✓/);
		assert.equal(record.buttons[0].title, 'Send to Copilot');
	});

	it('shows the model note when the pinned model was missing', async () => {
		const { record, handler } = setup({ modelNote: 'Your chosen checker model isn\'t available right now.' });
		await run(handler, record, 'add caching to the user lookup');
		assert.match(allText(record), /chosen checker model/);
	});
});

describe('participant: flagged prompts', () => {
	it('shows questions, a rewrite and buttons, and does not send', async () => {
		const { record, handler } = setup({ model: () => FLAG_JSON });
		const meta = await run(handler, record, 'help me design a caching layer');
		assert.equal(meta.outcome, 'flagged');
		assert.deepEqual(meta.missing, ['parameters', 'shape']);
		assert.deepEqual(meta.placeholders, ['[service]', '[expected load]']);
		assert.equal(record.handOffs.length, 0);

		const text = allText(record);
		assert.match(text, /⚠️ \*\*Missing Parameters and Shape\.\*\* No scale or output format given\./);
		assert.match(text, /For a design question: Mission ✓ · Ask ✓ · Parameters ✗ · Shape ✗/);
		assert.match(text, /1\. How many users do you expect\?/);
		assert.match(text, /```text\nDesign a caching layer/);
		assert.match(text, /Replace the \[brackets\]/);

		assert.deepEqual(record.buttons.map(b => b.title), ['Edit suggested prompt', 'Send mine anyway']);
		const edit = record.buttons[0].args[0] as HandOffRequest;
		assert.equal(edit.submit, false);
		assert.ok(edit.prompt.startsWith('@maps Design a caching layer'));
		const anyway = record.buttons[1].args[0] as HandOffRequest;
		assert.equal(anyway.submit, true);
		assert.equal(anyway.prompt, 'help me design a caching layer');
		assert.equal(anyway.reason, 'sendAnyway');

		assert.deepEqual(record.events, ['modelChecks', 'flagged']);
		assert.deepEqual(record.statuses, ['checking', 'flagged']);
	});

	it('suggests learning MAPS after a flag, and nothing after a pass', () => {
		const provider = createFollowupProvider(() => undefined);
		const flagged = provider.provideFollowups({ metadata: { outcome: 'flagged' } }, { history: [] }, token());
		assert.deepEqual(flagged, [{ prompt: 'What is MAPS?', label: 'What is MAPS?', command: 'explain' }]);
		const passed = provider.provideFollowups({ metadata: { outcome: 'passed' } }, { history: [] }, token());
		assert.deepEqual(passed, []);
	});

	it('releases a waiting hand-off when VS Code asks for followups', () => {
		const released: string[] = [];
		const provider = createFollowupProvider(id => released.push(id));
		provider.provideFollowups({ metadata: { outcome: 'passed', handOffId: 'abc' } }, { history: [] }, token());
		provider.provideFollowups({ metadata: { outcome: 'flagged' } }, { history: [] }, token());
		assert.deepEqual(released, ['abc']);
	});

	it('does not treat brackets from the original prompt as placeholders', async () => {
		const flag = JSON.stringify({
			size: 'task',
			verdict: 'improve',
			missing: ['parameters'],
			why: 'Which values?',
			questions: [],
			rewrite: 'Fix arr[index] in [file] so it handles [edge case].',
		});
		const { record, handler } = setup({ model: () => flag });
		const meta = await run(handler, record, 'arr[index] is wrong sometimes, sort it out');
		assert.deepEqual(meta.placeholders, ['[file]', '[edge case]']);
	});

	it('asks for placeholders to be filled before checking again', async () => {
		const { record, handler } = setup();
		const history = [
			new stub.ChatRequestTurn('help me design a caching layer', undefined),
			new stub.ChatResponseTurn([], { metadata: { outcome: 'flagged', placeholders: ['[service]', '[expected load]'] } }),
		];
		const meta = await run(handler, record, 'Design a caching layer for the user service handling [expected load].', { history });
		assert.equal(meta.outcome, 'placeholders');
		assert.equal(record.modelPrompts.length, 0);
		assert.match(allText(record), /Fill in the placeholder first: `\[expected load\]`/);
		assert.deepEqual(record.buttons.map(b => b.title), ['Edit prompt', 'Send as is']);
	});

	it('tells the checker when a prompt is a revision, and includes earlier prompts', async () => {
		const { record, handler } = setup();
		const history = [
			new stub.ChatRequestTurn('help me design a caching layer', undefined),
			new stub.ChatResponseTurn([], { metadata: { outcome: 'flagged', placeholders: ['[service]'] } }),
		];
		await run(handler, record, 'Design a caching layer for the user service handling 10k requests per second.', { history });
		assert.equal(record.modelPrompts.length, 1);
		assert.match(record.modelPrompts[0], /already revised this prompt/);
		assert.match(record.modelPrompts[0], /- help me design a caching layer/);
	});
});

describe('participant: history', () => {
	it('ignores /explain replies when looking for the last check', async () => {
		const { record, handler } = setup();
		const history = [
			new stub.ChatRequestTurn('help me design a caching layer', undefined),
			new stub.ChatResponseTurn([], { metadata: { outcome: 'flagged', placeholders: ['[expected load]'] } }),
			new stub.ChatRequestTurn('What is MAPS?', 'explain'),
			new stub.ChatResponseTurn([], { metadata: { outcome: 'explain' } }, 'check-the-maps.maps', 'explain'),
		];
		const meta = await run(handler, record, 'Design a caching layer handling [expected load].', { history });
		assert.equal(meta.outcome, 'placeholders');
	});

	it('does not treat an unrelated prompt after a flag as a revision', async () => {
		const { record, handler } = setup();
		const history = [
			new stub.ChatRequestTurn('help me design a caching layer', undefined),
			new stub.ChatResponseTurn([], { metadata: { outcome: 'flagged', placeholders: [] } }),
		];
		await run(handler, record, 'why does the payment webhook retry forever when stripe times out', { history });
		assert.doesNotMatch(record.modelPrompts[0], /already revised/);
	});
});

describe('participant: failing open', () => {
	it('sends unchecked when the model list cannot be read', async () => {
		const { record, handler } = setup({ model: 'throws' });
		const meta = await run(handler, record, 'add caching to the user lookup');
		assert.equal(meta.outcome, 'unchecked');
		assert.equal(record.handOffs.length, 1);
		assert.match(allText(record), /couldn't be read/);
	});

	it('only waits for the consent prompt until the model has answered once', async () => {
		const { record, handler } = setup({ consent: undefined });
		await run(handler, record, 'add caching to the user lookup');
		await run(handler, record, 'add caching to the order lookup');
		assert.match(record.progress[0], /may ask you to allow this/);
		assert.match(record.progress[1], /^Checking with GPT-6 Luna…$/);
	});

	it('escapes error text before showing it', async () => {
		const error = new Error('bad [link](command:evil) <img>');
		const { record, handler } = setup({ model: () => error });
		await run(handler, record, 'add caching to the user lookup');
		// Escaped brackets render as plain text, so no link is created.
		assert.match(allText(record), /\\\[link\\\]\(command:evil\) \\<img\\>/);
	});

	it('sends unchecked when no cheap model is available', async () => {
		const { record, handler } = setup({ model: 'none' });
		const meta = await run(handler, record, 'add caching to the user lookup');
		assert.equal(meta.outcome, 'unchecked');
		assert.equal(record.handOffs[0].reason, 'unchecked');
		assert.match(allText(record), /No low-cost model is available\. Sent to Copilot unchecked\./);
		assert.equal(record.buttons[0].title, 'Choose a checker model');
		assert.deepEqual(record.events, ['skipped']);
	});

	it('sends unchecked when the daily limit is reached, without a model call', async () => {
		const { record, handler } = setup({ underLimit: false });
		await run(handler, record, 'add caching to the user lookup');
		assert.equal(record.modelPrompts.length, 0);
		assert.match(allText(record), /today's limit of 300 checks/);
		assert.equal(record.handOffs.length, 1);
	});

	it('sends unchecked when the checker times out', async () => {
		const { record, handler } = setup({ model: () => 'hang', settings: { timeoutSeconds: 2 } });
		const started = Date.now();
		const meta = await run(handler, record, 'add caching to the user lookup');
		const elapsed = Date.now() - started;
		assert.equal(meta.outcome, 'unchecked');
		assert.ok(elapsed >= 1900 && elapsed < 4000, `took ${elapsed} ms`);
		assert.match(allText(record), /longer than 2 seconds/);
		assert.equal(record.handOffs.length, 1);
	});

	it('sends unchecked when the answer is unreadable', async () => {
		const { record, handler } = setup({ model: () => 'Sure! This prompt looks great.' });
		const meta = await run(handler, record, 'add caching to the user lookup');
		assert.equal(meta.outcome, 'unchecked');
		assert.match(allText(record), /couldn't be read/);
	});

	it('explains model errors in plain words', async () => {
		const error = Object.assign(new Error('nope'), { code: 'Blocked' });
		const { record, handler } = setup({ model: () => error });
		await run(handler, record, 'add caching to the user lookup');
		assert.match(allText(record), /rate-limited or over quota/);
	});

	it('does not call the model when access was declined', async () => {
		const { record, handler } = setup({ consent: false });
		const meta = await run(handler, record, 'add caching to the user lookup');
		assert.equal(meta.outcome, 'unchecked');
		assert.equal(record.modelPrompts.length, 0);
		assert.match(allText(record), /Manage Language Model Access/);
	});

	it('warns about the one-time consent prompt on first use', async () => {
		const { record, handler } = setup({ consent: undefined });
		await run(handler, record, 'add caching to the user lookup');
		assert.match(record.progress[0], /VS Code may ask you to allow this, just once/);
	});

	it('stays quiet and sends nothing when the request is cancelled', async () => {
		const { record, handler } = setup({ model: () => new Error('cancelled') });
		const meta = await run(handler, record, 'add caching to the user lookup', { cancelled: true });
		assert.equal(meta.outcome, 'unchecked');
		assert.equal(record.handOffs.length, 0);
		assert.equal(record.modelPrompts.length, 0);
		assert.deepEqual(record.markdown, []);

		// Even a prompt that would pass locally isn't sent after Stop.
		const local = await run(handler, record, 'rename helloWorld to helloDolly', { cancelled: true });
		assert.equal(local.outcome, 'unchecked');
		assert.equal(record.handOffs.length, 0);
	});

	it('/check never sends, even when unchecked', async () => {
		const { record, handler } = setup({ model: 'none' });
		await run(handler, record, 'add caching to the user lookup', { command: 'check' });
		assert.equal(record.handOffs.length, 0);
		assert.deepEqual(record.buttons.map(b => b.title), ['Choose a checker model', 'Send to Copilot']);
	});
});

describe('participant: attachments', () => {
	let refs: vscodeTypes.ChatPromptReference[];

	beforeEach(() => {
		const file = stub.Uri.parse('file:///workspace/src/api.ts');
		const other = stub.Uri.parse('file:///workspace/src/db.ts');
		refs = [
			{ id: 'vscode.file', value: file } as unknown as vscodeTypes.ChatPromptReference,
			{ id: 'vscode.file', value: other, range: [10, 25] } as unknown as vscodeTypes.ChatPromptReference,
			{
				id: 'vscode.implicit.selection',
				value: new stub.Location(file, new stub.Range(9, 0, 39, 0)),
			} as unknown as vscodeTypes.ChatPromptReference,
			{
				id: 'vscode.prompt.instructions.root__file:///workspace/.github/copilot-instructions.md',
				value: stub.Uri.parse('file:///workspace/.github/copilot-instructions.md'),
			} as unknown as vscodeTypes.ChatPromptReference,
		];
	});

	it('describes attachments to the checker and re-attaches explicit files, including inline ones', async () => {
		const { record, handler } = setup();
		await run(handler, record, 'what is the best way to cache user lookups here?', { references: refs });
		const checkPrompt = record.modelPrompts[0];
		assert.match(checkPrompt, /src\/api\.ts, src\/db\.ts, src\/api\.ts \(lines 10-40\) \(current editor\), instructions file \.github\/copilot-instructions\.md/);
		// db.ts was typed into the prompt (#file:db.ts); the text alone wouldn't bring the file along.
		assert.deepEqual(record.handOffs[0].files, ['file:///workspace/src/api.ts', 'file:///workspace/src/db.ts']);
		assert.deepEqual(record.handOffs[0].folders, []);
	});

	it('re-attaches folders as folders', async () => {
		const { record, handler } = setup({ folders: ['src'] });
		const folder = { id: 'vscode.folder', value: stub.Uri.parse('file:///workspace/src') } as unknown as vscodeTypes.ChatPromptReference;
		await run(handler, record, 'what is the best way to cache user lookups here?', { references: [folder] });
		assert.match(record.modelPrompts[0], /Attached: folder src/);
		assert.deepEqual(record.handOffs[0].folders, ['file:///workspace/src']);
		assert.deepEqual(record.handOffs[0].files, []);
	});

	it('counts explicit attachments as context for local triage', async () => {
		const { record, handler } = setup();
		const meta = await run(handler, record, 'add tests for this', { references: refs });
		assert.equal(meta.source, 'local');
	});

	it('puts the prompt back in the chat box when an attachment cannot be carried over', async () => {
		const { record, handler } = setup();
		const image = { id: 'image', value: { mimeType: 'image/png' }, modelDescription: 'screenshot.png' } as unknown as vscodeTypes.ChatPromptReference;
		await run(handler, record, 'rename helloWorld to helloDolly', { references: [image] });
		assert.equal(record.handOffs[0].submit, false);
		assert.match(allText(record), /Add the attachment that couldn't be carried over/);
	});
});
