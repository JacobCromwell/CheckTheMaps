/**
 * The @maps chat participant.
 *
 * Flow for each prompt:
 *   1. Local triage. Obviously small prompts pass instantly with no model call.
 *   2. Otherwise, a cheap checker model scores the prompt against MAPS.
 *   3. Pass: a one-line ✅ and the prompt is handed to Copilot automatically.
 *      Flag: one to three questions, a suggested rewrite and buttons.
 *
 * Anything that goes wrong (no model, timeout, unreadable answer, daily limit)
 * fails open: the prompt is sent on unchecked, with a one-line note. The
 * extension should never be the reason a developer can't get their prompt through.
 */

import * as vscode from 'vscode';
import type { Framework } from './core/frameworks';
import type { PriceEntry } from './core/models';
import {
	buildCheckPrompt,
	findPlaceholders,
	isLikelyRevision,
	parseVerdict,
	unfilledPlaceholders,
	type CheckContext,
	type CheckVerdict,
} from './core/rubric';
import { estimateTokens, type StatsEvent } from './core/stats';
import { triage, type RequestSize, type Strictness } from './core/triage';
import { JUSTIFICATION, checklist, escapeMarkdown, explain, fence, help, joinLabels } from './messages';

export const PARTICIPANT_ID = 'check-the-maps.maps';
/** The name developers type after `@`. Must match package.json. */
export const PARTICIPANT_NAME = 'maps';
export const HAND_OFF_COMMAND = 'checkTheMaps.handOff';
export const RESEND_COMMAND = 'checkTheMaps.resend';
export const CHOOSE_MODEL_COMMAND = 'checkTheMaps.chooseModel';

export interface Settings {
	/** The checklist prompts are checked against. */
	readonly framework: Framework;
	readonly strictness: Strictness;
	/** Hand passing prompts to Copilot automatically. */
	readonly autoSend: boolean;
	/** Chat mode to send in, such as `agent` or `ask`. Empty keeps the current mode. */
	readonly sendInMode: string;
	readonly timeoutSeconds: number;
	/** Model checks allowed per day. 0 means no limit. */
	readonly dailyCheckLimit: number;
}

export type HandOffReason = 'passed' | 'sendAnyway' | 'unchecked' | 'skipCheck' | 'edit';

export interface HandOffRequest {
	readonly prompt: string;
	/** Send right away (true), or put the prompt in the chat box for editing (false). */
	readonly submit: boolean;
	/** Chat mode to switch to first. Undefined keeps the current mode. */
	readonly mode?: string;
	/** URIs (as strings) of attached files to attach again. */
	readonly files?: readonly string[];
	/** URIs (as strings) of attached folders to attach again. */
	readonly folders?: readonly string[];
	readonly reason: HandOffReason;
}

export interface CheckerModel {
	readonly model: vscode.LanguageModelChat;
	readonly label: string;
	readonly price?: PriceEntry;
	/** Shown once, for example when a pinned model is missing and we fell back. */
	readonly note?: string;
}

export interface NoCheckerModel {
	readonly model?: undefined;
	readonly note: string;
}

export interface EditorContext {
	readonly activeFile?: string;
	readonly activeFileErrors: number;
	readonly hasSelection: boolean;
}

export type StatusState = 'checking' | 'passed' | 'flagged' | 'unchecked' | 'idle';

/** What an attached URI points at, as far as re-attaching it goes. */
export type UriKind = 'file' | 'folder' | 'unsupported';

/** Everything the handler needs from VS Code and extension state, so it can be tested. */
export interface HandlerDeps {
	settings(): Settings;
	resolveModel(): Promise<CheckerModel | NoCheckerModel>;
	/** `undefined` means the developer hasn't been asked for consent yet. */
	canSendRequest(model: vscode.LanguageModelChat): boolean | undefined;
	editorContext(): EditorContext;
	relativePath(uri: vscode.Uri): string;
	classifyUri(uri: vscode.Uri): Promise<UriKind>;
	underDailyLimit(): boolean;
	record(event: StatsEvent): void;
	recordCost(usd: number): void;
	/**
	 * Hands the prompt to Copilot as soon as this response has finished (chat
	 * ignores new requests while one is in progress). Returns an id, which goes in
	 * the result metadata and in the "send again" link.
	 */
	scheduleHandOff(request: HandOffRequest): string;
	setStatus(state: StatusState, detail?: string): void;
	log(message: string): void;
}

export type Outcome = 'passed' | 'flagged' | 'unchecked' | 'sent' | 'placeholders' | 'help' | 'explain';

export interface ResultMetadata {
	readonly outcome: Outcome;
	readonly size?: RequestSize;
	readonly source?: 'local' | 'model';
	readonly missing?: readonly string[];
	/** Name of the framework the prompt was checked against, such as `MAPS`. */
	readonly framework?: string;
	readonly placeholders?: readonly string[];
	/** Set when a hand-off is waiting for this response to finish. */
	readonly handOffId?: string;
}

interface Attachments {
	/** Descriptions for the checker, such as `src/api.ts (lines 10-40)`. */
	readonly descriptions: string[];
	/** Attachments the developer added on purpose (not implicit context or instructions). */
	explicitCount: number;
	/** Files to attach again when handing off. */
	readonly files: string[];
	/** Folders to attach again when handing off. */
	readonly folders: string[];
	/** Attachments we can't pass along, such as images. */
	unforwardable: number;
}

class CheckTimeoutError extends Error {
	constructor(readonly seconds: number) {
		super(`The check took longer than ${seconds} seconds.`);
	}
}

function isAutomaticContext(id: string): boolean {
	return id.startsWith('vscode.implicit') || id.startsWith('vscode.prompt.');
}

function clip(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function collectAttachments(request: vscode.ChatRequest, deps: HandlerDeps): Promise<Attachments> {
	const result: Attachments = { descriptions: [], explicitCount: 0, files: [], folders: [], unforwardable: 0 };
	for (const ref of request.references) {
		const automatic = isAutomaticContext(ref.id);
		const value = ref.value;
		let description: string;
		let uri: vscode.Uri | undefined;
		if (value instanceof vscode.Uri) {
			uri = value;
			description = deps.relativePath(value);
		} else if (value instanceof vscode.Location) {
			uri = value.uri;
			const { start, end } = value.range;
			description = `${deps.relativePath(value.uri)} (lines ${start.line + 1}-${end.line + 1})`;
		} else {
			description = ref.modelDescription ? clip(ref.modelDescription, 80) : `#${ref.id}`;
		}

		if (automatic) {
			// Copilot adds the current editor and instructions files by itself.
			description = ref.id.startsWith('vscode.prompt.') ? `instructions file ${description}` : `${description} (current editor)`;
		} else {
			result.explicitCount++;
			// Re-attach even references typed into the prompt (#file:x): the text alone
			// doesn't bring the file along when the prompt is sent programmatically.
			const kind = uri ? await deps.classifyUri(uri) : 'unsupported';
			if (kind === 'file' && uri) {
				result.files.push(uri.toString());
			} else if (kind === 'folder' && uri) {
				result.folders.push(uri.toString());
				description = `folder ${description}`;
			} else {
				result.unforwardable++;
			}
		}
		result.descriptions.push(description);
	}
	for (const tool of request.toolReferences) {
		result.descriptions.push(`#${tool.name} tool`);
	}
	return result;
}

interface HistoryInfo {
	readonly earlierPrompts: string[];
	/** Metadata of the last real check (help and /explain replies are skipped). */
	readonly lastMetadata?: ResultMetadata;
	/** The prompt that produced {@link lastMetadata}. */
	readonly lastPrompt?: string;
}

function readHistory(context: vscode.ChatContext): HistoryInfo {
	const earlierPrompts: string[] = [];
	let pendingPrompt: string | undefined;
	let lastMetadata: ResultMetadata | undefined;
	let lastPrompt: string | undefined;
	for (const turn of context.history) {
		if (turn instanceof vscode.ChatRequestTurn) {
			pendingPrompt = turn.prompt;
			if (turn.prompt.trim() && turn.command !== 'explain') {
				earlierPrompts.push(turn.prompt);
			}
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const metadata = turn.result.metadata as ResultMetadata | undefined;
			if (metadata && metadata.outcome !== 'explain' && metadata.outcome !== 'help') {
				lastMetadata = metadata;
				lastPrompt = pendingPrompt;
			}
		}
	}
	return { earlierPrompts: earlierPrompts.slice(-3), lastMetadata, lastPrompt };
}

async function askModel(
	model: vscode.LanguageModelChat,
	prompt: string,
	timeoutMs: number,
	token: vscode.CancellationToken,
): Promise<string> {
	const cts = new vscode.CancellationTokenSource();
	const cancelListener = token.onCancellationRequested(() => cts.cancel());
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			cts.cancel();
			reject(new CheckTimeoutError(Math.round(timeoutMs / 1000)));
		}, timeoutMs);
	});
	const run = (async () => {
		const response = await model.sendRequest(
			[vscode.LanguageModelChatMessage.User(prompt)],
			{ justification: JUSTIFICATION },
			cts.token,
		);
		let text = '';
		for await (const chunk of response.text) {
			text += chunk;
			if (text.length > 20_000) {
				break;
			}
		}
		return text;
	})();
	// If the timeout wins, the model call may still fail later; don't let that surface as an unhandled rejection.
	run.catch(() => undefined);
	try {
		return await Promise.race([run, timeout]);
	} finally {
		clearTimeout(timer);
		cancelListener.dispose();
		cts.dispose();
	}
}

function describeFailure(error: unknown, modelLabel: string): string {
	if (error instanceof CheckTimeoutError) {
		return `The check took longer than ${error.seconds} seconds.`;
	}
	const code = (error as { code?: unknown })?.code;
	switch (code) {
		case 'NoPermissions':
			return `Check The MAPS wasn't given access to ${modelLabel}.`;
		case 'Blocked':
			return `${modelLabel} is rate-limited or over quota right now.`;
		case 'NotFound':
			return `${modelLabel} is no longer available.`;
		default: {
			const message = error instanceof Error ? error.message : String(error);
			return `The check failed (${clip(message, 120)}).`;
		}
	}
}

/** A trusted markdown string that may run only our own commands. */
function trustedMarkdown(value: string): vscode.MarkdownString {
	const md = new vscode.MarkdownString(value);
	md.isTrusted = { enabledCommands: [RESEND_COMMAND] };
	return md;
}

/** A small ↻ link that sends the prompt again, in case the hand-off didn't go through. */
function resendLink(id: string): string {
	return `[↻](command:${RESEND_COMMAND}?${encodeURIComponent(JSON.stringify([id]))} "Didn't reach Copilot? Send it again")`;
}

export function createHandler(deps: HandlerDeps): vscode.ChatRequestHandler {
	/** Models that have answered at least once, so consent has been given. */
	const modelsUsed = new Set<string>();

	return async (request, context, stream, token): Promise<vscode.ChatResult> => {
		const settings = deps.settings();
		const framework = settings.framework;
		const meta = (metadata: ResultMetadata): vscode.ChatResult => ({
			metadata: { framework: framework.name, ...metadata },
		});

		if (request.command === 'explain') {
			stream.markdown(explain(framework));
			return meta({ outcome: 'explain' });
		}

		const prompt = request.prompt.trim();
		if (!prompt) {
			stream.markdown(help(framework));
			return meta({ outcome: 'help' });
		}

		const mode = settings.sendInMode.trim() || undefined;
		const attachments = await collectAttachments(request, deps);
		if (token.isCancellationRequested) {
			return meta({ outcome: 'unchecked' });
		}
		const history = readHistory(context);
		const checkOnly = request.command === 'check';
		const autoSend = settings.autoSend && !checkOnly;

		const handOff = (submit: boolean, reason: HandOffReason, text = request.prompt): HandOffRequest => ({
			// Edited prompts come back through @maps so they get checked again before going to Copilot.
			prompt: reason === 'edit' ? `@${PARTICIPANT_NAME} ${text}` : text,
			submit,
			mode,
			files: attachments.files,
			folders: attachments.folders,
			reason,
		});

		const sendButton = (title: string, reason: HandOffReason, submit = true, text?: string) =>
			stream.button({ command: HAND_OFF_COMMAND, title, arguments: [handOff(submit, reason, text)] });

		/**
		 * Sends the prompt on, or offers a button when auto-send is off. Returns the
		 * hand-off id when one was scheduled.
		 */
		const sendOn = (
			reason: HandOffReason,
			line: string,
			sentText = 'Sent to Copilot.',
			alwaysSend = false,
		): string | undefined => {
			const send = autoSend || alwaysSend;
			if (send && attachments.unforwardable === 0) {
				const id = deps.scheduleHandOff(handOff(true, reason));
				stream.markdown(trustedMarkdown(`${line} ${sentText} ${resendLink(id)}`));
				return id;
			}
			if (send) {
				// Images and pasted content can't be re-attached, so let the developer add them and send.
				const id = deps.scheduleHandOff(handOff(false, reason));
				const items = attachments.unforwardable === 1 ? 'the attachment' : 'the attachments';
				stream.markdown(
					`${line} Your prompt is back in the chat box. Add ${items} that couldn't be carried over (such as images) again, then send.`,
				);
				return id;
			}
			stream.markdown(line);
			sendButton('Send to Copilot', reason);
			return undefined;
		};

		const unchecked = (why: string, extra?: () => void): vscode.ChatResult => {
			deps.record('skipped');
			deps.setStatus('unchecked', why);
			deps.log(`unchecked: ${why}`);
			const safeWhy = escapeMarkdown(why);
			if (checkOnly) {
				stream.markdown(`⏭️ ${safeWhy} The prompt wasn't checked.`);
				extra?.();
				sendButton('Send to Copilot', 'unchecked');
				return meta({ outcome: 'unchecked' });
			}
			const handOffId = sendOn('unchecked', `⏭️ ${safeWhy}`, 'Sent to Copilot unchecked.');
			extra?.();
			return meta({ outcome: 'unchecked', handOffId });
		};

		const passed = (size: RequestSize, source: 'local' | 'model', reason: string): vscode.ChatResult => {
			deps.record(source === 'local' ? 'passedLocally' : 'passedByModel');
			deps.setStatus('passed', `Passed: ${reason}`);
			deps.log(`passed (${source}, ${size}): ${reason}`);
			if (checkOnly) {
				stream.markdown(`✅ **Passes ${framework.name}.** ${checklist(framework, size, [])}`);
				sendButton('Send to Copilot', 'passed');
				return meta({ outcome: 'passed', size, source });
			}
			const handOffId = sendOn('passed', '✅ Looks good.');
			return meta({ outcome: 'passed', size, source, handOffId });
		};

		if (request.command === 'send') {
			deps.record('skipped');
			deps.setStatus('unchecked', 'Sent without a check');
			const handOffId = sendOn('skipCheck', '↪️', 'Sent to Copilot without a check.', true);
			return meta({ outcome: 'sent', handOffId });
		}

		// The developer clicked "Edit suggested prompt" but left [placeholders] in it.
		const placeholders = history.lastMetadata?.placeholders ?? [];
		const unfilled = unfilledPlaceholders(prompt, placeholders);
		if (unfilled.length) {
			deps.setStatus('flagged', 'Placeholders left to fill in');
			const one = unfilled.length === 1;
			const list = unfilled.map(p => `\`${p.replace(/`/g, '')}\``).join(', ');
			stream.markdown(
				`✏️ Fill in ${one ? 'the placeholder' : 'the placeholders'} first: ${list}. Replace ${one ? 'it' : 'them'} with the real details, or delete ${one ? 'it' : 'them'} if ${one ? "it doesn't" : "they don't"} apply.`,
			);
			sendButton('Edit prompt', 'edit', false);
			sendButton('Send as is', 'sendAnyway');
			return meta({ outcome: 'placeholders', placeholders });
		}

		const editor = deps.editorContext();
		const local = triage({
			prompt,
			hasAttachments: attachments.explicitCount > 0,
			hasSelection: editor.hasSelection,
			activeFileHasErrors: editor.activeFileErrors > 0,
			hasEarlierTurns: history.earlierPrompts.length > 0,
			strictness: settings.strictness,
		});
		deps.log(`triage: ${local.route} (${local.size}): ${local.reason}`);

		if (local.route === 'pass') {
			return passed(local.size, 'local', local.reason);
		}

		if (!deps.underDailyLimit()) {
			return unchecked(`You've reached today's limit of ${settings.dailyCheckLimit} checks.`);
		}

		const chooseModelButton = () =>
			stream.button({ command: CHOOSE_MODEL_COMMAND, title: 'Choose a checker model' });

		let choice: CheckerModel | NoCheckerModel;
		try {
			choice = await deps.resolveModel();
		} catch (error) {
			deps.log(`model lookup failed: ${String(error)}`);
			return unchecked("The list of language models couldn't be read.");
		}
		if (token.isCancellationRequested) {
			return meta({ outcome: 'unchecked' });
		}
		if (!choice.model) {
			return unchecked(choice.note, chooseModelButton);
		}
		if (choice.note) {
			stream.markdown(`_${escapeMarkdown(choice.note)}_\n\n`);
		}

		const consent = deps.canSendRequest(choice.model);
		if (consent === false) {
			return unchecked(
				`Check The MAPS doesn't have access to ${choice.label}. You can allow it from the Accounts menu (Manage Language Model Access), or choose another model.`,
				chooseModelButton,
			);
		}
		// The first request shows a consent dialog, so give the developer time to read it.
		const firstUse = consent === undefined && !modelsUsed.has(choice.model.id);
		stream.progress(
			firstUse
				? `Checking with ${choice.label}. VS Code may ask you to allow this, just once.`
				: `Checking with ${choice.label}…`,
		);
		deps.setStatus('checking', `Checking with ${choice.label}`);

		const lastOutcome = history.lastMetadata?.outcome;
		const isRevision =
			(lastOutcome === 'flagged' || lastOutcome === 'placeholders') &&
			history.lastPrompt !== undefined &&
			isLikelyRevision(history.lastPrompt, prompt);
		const checkContext: CheckContext = {
			attachments: attachments.descriptions,
			activeFile: editor.activeFile,
			activeFileErrors: editor.activeFileErrors,
			hasSelection: editor.hasSelection,
			earlierPrompts: history.earlierPrompts,
			isRevision,
		};
		const checkPrompt = buildCheckPrompt(prompt, local.size, checkContext, settings.strictness, framework);

		const timeoutMs = firstUse ? 120_000 : Math.max(2, settings.timeoutSeconds) * 1000;
		deps.record('modelChecks');
		const started = Date.now();
		let raw: string;
		try {
			raw = await askModel(choice.model, checkPrompt, timeoutMs, token);
		} catch (error) {
			if (token.isCancellationRequested) {
				deps.setStatus('idle');
				return meta({ outcome: 'unchecked' });
			}
			deps.log(`check failed after ${Date.now() - started} ms: ${String(error)}`);
			return unchecked(describeFailure(error, choice.label));
		}
		modelsUsed.add(choice.model.id);
		if (choice.price) {
			deps.recordCost(
				(estimateTokens(checkPrompt) * choice.price.inputPerM + estimateTokens(raw) * choice.price.outputPerM) /
					1_000_000,
			);
		}
		deps.log(`checker answered in ${Date.now() - started} ms`);

		const verdict = parseVerdict(raw, framework);
		if (!verdict) {
			// Log only the size: the answer can quote the developer's prompt.
			deps.log(`unreadable checker answer (${raw.length} characters)`);
			return unchecked(`The checker's answer couldn't be read.`);
		}

		if (verdict.verdict === 'pass') {
			return passed(verdict.size, 'model', verdict.why || 'model check');
		}

		return flagged(verdict);

		function flagged(v: CheckVerdict): vscode.ChatResult {
			deps.record('flagged');
			const headline = v.missing.length ? `Missing ${joinLabels(framework, v.missing)}` : 'A few details would help';
			deps.setStatus('flagged', headline);
			deps.log(`flagged (${v.size}): ${v.missing.join(', ') || 'questions only'}`);

			const parts: string[] = [];
			parts.push(`⚠️ **${headline}.**${v.why ? ` ${escapeMarkdown(v.why)}` : ''}`);
			parts.push(`_${checklist(framework, v.size, v.missing)}_`);
			if (v.questions.length) {
				parts.push(
					`**Worth answering first:**\n${v.questions.map((q, i) => `${i + 1}. ${escapeMarkdown(q)}`).join('\n')}`,
				);
			}
			// Brackets that were already in the developer's prompt (like arr[i]) aren't placeholders.
			const rewritePlaceholders = v.rewrite ? findPlaceholders(v.rewrite).filter(p => !prompt.includes(p)) : [];
			if (v.rewrite) {
				const hint = rewritePlaceholders.length ? ' Replace the [brackets] with your details.' : '';
				parts.push(`**Suggested prompt.**${hint}\n\n${fence(v.rewrite)}`);
			}
			stream.markdown(parts.join('\n\n'));

			if (v.rewrite) {
				sendButton('Edit suggested prompt', 'edit', false, v.rewrite);
			} else {
				sendButton('Edit my prompt', 'edit', false);
			}
			sendButton(checkOnly ? 'Send to Copilot' : 'Send mine anyway', 'sendAnyway');

			return meta({
				outcome: 'flagged',
				size: v.size,
				source: 'model',
				missing: v.missing,
				placeholders: rewritePlaceholders,
			});
		}
	};
}

/**
 * Followups double as our "response finished" signal: VS Code asks for them in
 * the same step that marks the response complete, so a waiting hand-off can go
 * right away. After a flagged prompt, we also offer "What is MAPS?" (or the active framework's name).
 */
export function createFollowupProvider(releaseHandOff: (id: string) => void): vscode.ChatFollowupProvider {
	return {
		provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
			const metadata = result.metadata as ResultMetadata | undefined;
			if (metadata?.handOffId) {
				releaseHandOff(metadata.handOffId);
			}
			if (metadata?.outcome === 'flagged') {
				const question = `What is ${metadata.framework ?? 'MAPS'}?`;
				return [{ prompt: question, label: question, command: 'explain' }];
			}
			return [];
		},
	};
}
