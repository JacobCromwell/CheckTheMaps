/**
 * Handing prompts to Copilot.
 *
 * VS Code has no API for sending a chat request on a participant's behalf, so we
 * use the chat's own commands:
 *
 * - To send, we target the chat the developer is typing in (the Chat view, a chat
 *   editor tab or Quick Chat): attach files, optionally switch mode, then submit
 *   the prompt with `workbench.action.chat.submit`.
 * - To put a prompt in the chat box without sending it, and as the fallback when
 *   the above fails, we use `workbench.action.chat.open`, which targets the Chat view.
 *
 * Chat ignores a new request while a response is still in progress, so a hand-off
 * waits for the @maps response to finish. VS Code asks the participant for
 * followups in the same step that marks a response complete, so the followup
 * provider releases waiting hand-offs (see createFollowupProvider). A timer is
 * the backstop in case followups are never requested.
 */

import * as vscode from 'vscode';
import type { HandOffRequest } from './participant';

const CHAT_OPEN = 'workbench.action.chat.open';
const CHAT_SUBMIT = 'workbench.action.chat.submit';
const CHAT_ATTACH_FILE = 'workbench.action.chat.attachFile';
const CHAT_ATTACH_FOLDER = 'workbench.action.chat.attachFolder';
const CHAT_SET_MODE = 'workbench.action.chat.toggleAgentMode';

/**
 * Modes that are safe to switch to in the focused chat. The switch command moves
 * to the *next* mode when it can't find the one asked for (Agent mode is missing
 * without a tools agent), so every other mode goes through `chat.open`, which
 * ignores modes it doesn't know.
 */
const SAFE_FOCUSED_MODES = new Set(['ask']);

/** Backstop: send anyway if VS Code hasn't asked for followups by then. */
export const FALLBACK_DELAY_MS = 1500;

/** Wait before putting `@maps ` back in the chat box, so the submit has cleared it first. */
export const REFILL_DELAY_MS = 1200;

/** How many recent hand-offs the ↻ link can resend. */
const RECENT_LIMIT = 25;

export interface HandOffHooks {
	/** Called after a hand-off is delivered to the chat. */
	onSent(request: HandOffRequest): void;
	/**
	 * Whether to put `@maps ` back in the chat box. `sentAt` is when the prompt was
	 * sent, so the check can skip the refill if the developer has moved on since.
	 */
	shouldRefill(sentAt: number): boolean;
	log(message: string): void;
}

interface Pending {
	readonly request: HandOffRequest;
	readonly timer: ReturnType<typeof setTimeout>;
}

function toUris(values: readonly string[] | undefined): vscode.Uri[] {
	return (values ?? []).map(value => vscode.Uri.parse(value));
}

export class HandOffService implements vscode.Disposable {
	private readonly pending = new Map<string, Pending>();
	private readonly recent = new Map<string, HandOffRequest>();
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();
	private counter = 0;

	constructor(
		private readonly participantName: string,
		private readonly hooks: HandOffHooks,
	) {}

	/** Queues a hand-off until the current @maps response finishes. Returns its id. */
	schedule(request: HandOffRequest): string {
		const id = `${Date.now().toString(36)}-${++this.counter}`;
		this.recent.set(id, request);
		while (this.recent.size > RECENT_LIMIT) {
			const oldest = this.recent.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.recent.delete(oldest);
		}
		const timer = setTimeout(() => this.release(id, 'timer'), FALLBACK_DELAY_MS);
		this.pending.set(id, { request, timer });
		return id;
	}

	/** Sends a queued hand-off now. Safe to call more than once; only the first call sends. */
	release(id: string, trigger: 'followups' | 'timer' = 'followups'): void {
		const entry = this.pending.get(id);
		if (!entry) {
			return;
		}
		this.pending.delete(id);
		clearTimeout(entry.timer);
		this.hooks.log(`hand-off released by ${trigger}`);
		void this.send(entry.request);
	}

	/** Sends a recent hand-off again (the ↻ link). */
	async resend(id: unknown): Promise<void> {
		const request = typeof id === 'string' ? this.recent.get(id) : undefined;
		if (!request) {
			void vscode.window.showInformationMessage(
				'That prompt is no longer available to resend. Copy it from the chat and send it again.',
			);
			return;
		}
		if (this.pending.has(id as string)) {
			// Still waiting; send it now instead of twice.
			this.release(id as string);
			return;
		}
		await this.send({ ...request, submit: true });
	}

	async send(request: HandOffRequest): Promise<void> {
		try {
			if (request.submit) {
				await this.submitToFocusedChat(request);
			} else {
				await this.openInChatView(request);
			}
			this.hooks.log(`handed off (${request.reason}, ${request.submit ? 'sent' : 'placed in the chat box'})`);
			this.hooks.onSent(request);
			if (request.submit) {
				this.scheduleRefill();
			}
		} catch (error) {
			this.hooks.log(`hand-off failed: ${String(error)}`);
			await vscode.env.clipboard.writeText(request.prompt);
			void vscode.window.showWarningMessage(
				"Check The MAPS couldn't pass your prompt to Copilot, so it's on your clipboard. Paste it into the chat to send it.",
			);
		}
	}

	/** Sends into the chat the developer last used, wherever it is. Falls back to the Chat view. */
	private async submitToFocusedChat(request: HandOffRequest): Promise<void> {
		if (request.mode && !SAFE_FOCUSED_MODES.has(request.mode)) {
			await this.openInChatView(request);
			return;
		}
		try {
			// Switch mode first: a mode switch can start a new session, which would drop attachments.
			if (request.mode) {
				await vscode.commands.executeCommand(CHAT_SET_MODE, { modeId: request.mode });
			}
			const files = toUris(request.files);
			const folders = toUris(request.folders);
			if (files.length) {
				await vscode.commands.executeCommand(CHAT_ATTACH_FILE, files[0], files);
			}
			if (folders.length) {
				await vscode.commands.executeCommand(CHAT_ATTACH_FOLDER, folders[0], folders);
			}
			await vscode.commands.executeCommand(CHAT_SUBMIT, { inputValue: request.prompt });
		} catch (error) {
			this.hooks.log(`sending to the focused chat failed, using the Chat view instead: ${String(error)}`);
			await this.openInChatView(request);
		}
	}

	/** Puts the prompt in the Chat view's input, and submits it unless it's partial. */
	private async openInChatView(request: HandOffRequest): Promise<void> {
		const options: Record<string, unknown> = {
			query: request.prompt,
			isPartialQuery: !request.submit,
		};
		if (request.mode) {
			options.mode = request.mode;
		}
		// chat.open checks that each file exists, which untitled documents can't pass.
		const files = toUris(request.files).filter(uri => uri.scheme !== 'untitled');
		if (files.length) {
			options.attachFiles = files;
		}
		await vscode.commands.executeCommand(CHAT_OPEN, options);
	}

	/**
	 * Sending clears the chat box, so `@maps` would disappear after every passing
	 * prompt. Put it back, so the next prompt is checked too.
	 */
	private scheduleRefill(): void {
		const sentAt = Date.now();
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			if (!this.hooks.shouldRefill(sentAt)) {
				return;
			}
			void Promise.resolve(
				vscode.commands.executeCommand(CHAT_OPEN, { query: `@${this.participantName} `, isPartialQuery: true }),
			).catch(error => this.hooks.log(`couldn't put @${this.participantName} back: ${String(error)}`));
		}, REFILL_DELAY_MS);
		this.timers.add(timer);
	}

	dispose(): void {
		for (const { timer } of this.pending.values()) {
			clearTimeout(timer);
		}
		this.pending.clear();
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}
}

/** Opens the chat with `@maps ` ready to type after. */
export async function startCheckedPrompt(participantName: string): Promise<void> {
	await vscode.commands.executeCommand(CHAT_OPEN, { query: `@${participantName} `, isPartialQuery: true });
}

/** Asks @maps to explain MAPS in the chat. */
export async function explainInChat(participantName: string): Promise<void> {
	await vscode.commands.executeCommand(CHAT_OPEN, { query: `@${participantName} /explain` });
}

/**
 * True when the developer is probably using the Chat view rather than a chat
 * editor tab. Refilling the chat box uses the Chat view, so we skip it when the
 * active editor tab isn't a regular editor (a chat editor tab has an input type
 * extensions can't see).
 */
export function chatIsProbablyInView(): boolean {
	const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
	if (!tab) {
		return true;
	}
	const input = tab.input;
	return (
		input instanceof vscode.TabInputText ||
		input instanceof vscode.TabInputTextDiff ||
		input instanceof vscode.TabInputCustom ||
		input instanceof vscode.TabInputWebview ||
		input instanceof vscode.TabInputNotebook ||
		input instanceof vscode.TabInputNotebookDiff ||
		input instanceof vscode.TabInputTerminal
	);
}
