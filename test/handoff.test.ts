import './support/stubVscode';

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it, mock } from 'node:test';
import { FALLBACK_DELAY_MS, HandOffService, chatIsProbablyInView } from '../src/handoff';
import type { HandOffRequest } from '../src/participant';
import * as stub from './support/vscode';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function service(refill = false) {
	const sent: HandOffRequest[] = [];
	const svc = new HandOffService('maps', {
		onSent: request => sent.push(request),
		shouldRefill: () => refill,
		log: () => undefined,
	});
	return { svc, sent };
}

const request = (overrides: Partial<HandOffRequest> = {}): HandOffRequest => ({
	prompt: 'rename helloWorld to helloDolly',
	submit: true,
	files: [],
	folders: [],
	reason: 'passed',
	...overrides,
});

const names = () => stub.recorder.calls.map(c => c.command);

describe('HandOffService', () => {
	beforeEach(() => stub.recorder.reset());

	it('waits for release, then submits to the focused chat exactly once', async () => {
		const { svc, sent } = service();
		const id = svc.schedule(request());
		await flush();
		assert.deepEqual(names(), []);

		svc.release(id);
		svc.release(id);
		await flush();
		assert.deepEqual(names(), ['workbench.action.chat.submit']);
		assert.deepEqual(stub.recorder.calls[0].args, [{ inputValue: 'rename helloWorld to helloDolly' }]);
		assert.equal(sent.length, 1);
		svc.dispose();
	});

	it('sends anyway after the backstop delay if followups never arrive', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			const { svc } = service();
			svc.schedule(request());
			mock.timers.tick(FALLBACK_DELAY_MS - 1);
			await flush();
			assert.deepEqual(names(), []);
			mock.timers.tick(1);
			await flush();
			assert.deepEqual(names(), ['workbench.action.chat.submit']);
			svc.dispose();
		} finally {
			mock.timers.reset();
		}
	});

	it('attaches files and folders and switches built-in modes before submitting', async () => {
		const { svc } = service();
		await svc.send(
			request({
				mode: 'agent',
				files: ['file:///workspace/a.ts', 'file:///workspace/b.ts'],
				folders: ['file:///workspace/src'],
			}),
		);
		assert.deepEqual(names(), [
			'workbench.action.chat.attachFile',
			'workbench.action.chat.attachFolder',
			'workbench.action.chat.toggleAgentMode',
			'workbench.action.chat.submit',
		]);
		const [first, all] = stub.recorder.calls[0].args as [stub.Uri, stub.Uri[]];
		assert.equal(first.toString(), 'file:///workspace/a.ts');
		assert.equal(all.length, 2);
		assert.deepEqual(stub.recorder.calls[2].args, [{ modeId: 'agent' }]);
	});

	it('uses the Chat view for custom agents, which are selected by name', async () => {
		const { svc } = service();
		await svc.send(request({ mode: 'Reviewer' }));
		assert.deepEqual(names(), ['workbench.action.chat.open']);
		assert.deepEqual(stub.recorder.calls[0].args, [
			{ query: 'rename helloWorld to helloDolly', isPartialQuery: false, mode: 'Reviewer' },
		]);
	});

	it('falls back to the Chat view when submitting to the focused chat fails', async () => {
		stub.recorder.failing.add('workbench.action.chat.submit');
		const { svc, sent } = service();
		await svc.send(request({ files: ['file:///workspace/a.ts', 'untitled:Untitled-1'] }));
		assert.deepEqual(names(), [
			'workbench.action.chat.attachFile',
			'workbench.action.chat.submit',
			'workbench.action.chat.open',
		]);
		const options = stub.recorder.calls[2].args[0] as { attachFiles: stub.Uri[] };
		// chat.open can't attach untitled documents.
		assert.deepEqual(options.attachFiles.map(u => u.toString()), ['file:///workspace/a.ts']);
		assert.equal(sent.length, 1);
	});

	it('puts partial prompts in the Chat view without sending', async () => {
		const { svc } = service();
		await svc.send(request({ prompt: '@maps Design [x]', submit: false, reason: 'edit' }));
		assert.deepEqual(stub.recorder.calls[0], {
			command: 'workbench.action.chat.open',
			args: [{ query: '@maps Design [x]', isPartialQuery: true }],
		});
	});

	it('copies the prompt to the clipboard when nothing works', async () => {
		stub.recorder.failing.add('workbench.action.chat.submit');
		stub.recorder.failing.add('workbench.action.chat.open');
		const { svc, sent } = service();
		await svc.send(request());
		assert.equal(stub.recorder.clipboard, 'rename helloWorld to helloDolly');
		assert.match(stub.recorder.messages[0], /on your clipboard/);
		assert.equal(sent.length, 0);
	});

	it('puts @maps back in the chat box after sending, when asked to', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			const { svc } = service(true);
			await svc.send(request());
			mock.timers.tick(1000);
			await flush();
			assert.deepEqual(stub.recorder.calls.at(-1), {
				command: 'workbench.action.chat.open',
				args: [{ query: '@maps ', isPartialQuery: true }],
			});
			svc.dispose();
		} finally {
			mock.timers.reset();
		}
	});

	it('does not put @maps back when refilling is off', async () => {
		mock.timers.enable({ apis: ['setTimeout'] });
		try {
			const { svc } = service(false);
			await svc.send(request());
			mock.timers.tick(1000);
			await flush();
			assert.deepEqual(names(), ['workbench.action.chat.submit']);
		} finally {
			mock.timers.reset();
		}
	});

	it('resends recent prompts, and explains when one is too old', async () => {
		const { svc } = service();
		const id = svc.schedule(request());
		await svc.resend(id); // still pending: released instead of sent twice
		await flush();
		await svc.resend(id);
		await flush();
		assert.deepEqual(names(), ['workbench.action.chat.submit', 'workbench.action.chat.submit']);

		await svc.resend('unknown');
		assert.match(stub.recorder.messages[0], /no longer available/);
		svc.dispose();
	});
});

describe('chatIsProbablyInView', () => {
	it('is true with no editor tab or a regular file tab', () => {
		stub.window.tabGroups.activeTabGroup.activeTab = undefined;
		assert.equal(chatIsProbablyInView(), true);
		stub.window.tabGroups.activeTabGroup.activeTab = { input: new stub.TabInputText(stub.Uri.file('/a.ts')) };
		assert.equal(chatIsProbablyInView(), true);
	});

	it('is false when the active tab is something extensions cannot see, like a chat editor', () => {
		stub.window.tabGroups.activeTabGroup.activeTab = { input: {} };
		assert.equal(chatIsProbablyInView(), false);
		stub.window.tabGroups.activeTabGroup.activeTab = undefined;
	});
});
