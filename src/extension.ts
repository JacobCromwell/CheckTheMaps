/**
 * Check The MAPS: a quick, low-cost pre-flight check for Copilot prompts.
 *
 * Wires the @maps chat participant to VS Code: settings, the checker model,
 * hand-off to Copilot, local daily stats, the status bar item and commands.
 */

import * as vscode from 'vscode';
import { addCost, currentStats, recordEvent, summarize, todayKey, underDailyLimit, type DailyStats } from './core/stats';
import type { Strictness } from './core/triage';
import { HandOffService, chatIsProbablyInView, explainInChat, startCheckedPrompt } from './handoff';
import { CONFIG_SECTION, ModelResolver } from './modelResolver';
import {
	CHOOSE_MODEL_COMMAND,
	HAND_OFF_COMMAND,
	PARTICIPANT_ID,
	PARTICIPANT_NAME,
	RESEND_COMMAND,
	createFollowupProvider,
	createHandler,
	type EditorContext,
	type HandOffRequest,
	type Settings,
	type UriKind,
} from './participant';
import { StatusBar } from './statusBar';

const STATS_KEY = 'checkTheMaps.dailyStats';
const WELCOMED_KEY = 'checkTheMaps.welcomed';

/** Set on activation: `<publisher>.<name>#<walkthrough id>`. */
let walkthroughId = '';

function openWalkthrough(): Thenable<unknown> {
	return vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
}

const COMMANDS = {
	startCheckedPrompt: 'checkTheMaps.startCheckedPrompt',
	chooseModel: CHOOSE_MODEL_COMMAND,
	showMenu: 'checkTheMaps.showMenu',
	toggleAutoSend: 'checkTheMaps.toggleAutoSend',
	setStrictness: 'checkTheMaps.setStrictness',
	explain: 'checkTheMaps.explain',
	openSettings: 'checkTheMaps.openSettings',
	showLog: 'checkTheMaps.showLog',
	handOff: HAND_OFF_COMMAND,
	resend: RESEND_COMMAND,
} as const;

const STRICTNESS_VALUES: readonly Strictness[] = ['lenient', 'balanced', 'strict'];

function config(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function readSettings(): Settings {
	const c = config();
	const strictness = c.get<string>('strictness', 'lenient');
	return {
		strictness: (STRICTNESS_VALUES as readonly string[]).includes(strictness) ? (strictness as Strictness) : 'lenient',
		autoSend: c.get<boolean>('autoSend', true),
		sendInMode: c.get<string>('sendInMode', ''),
		timeoutSeconds: c.get<number>('timeoutSeconds', 8),
		dailyCheckLimit: c.get<number>('dailyCheckLimit', 300),
	};
}

/** Schemes the chat can attach (see the chat's attach-file command). */
const ATTACHABLE_SCHEMES = new Set(['file', 'vscode-remote', 'untitled']);

async function classifyUri(uri: vscode.Uri): Promise<UriKind> {
	if (!ATTACHABLE_SCHEMES.has(uri.scheme)) {
		return 'unsupported';
	}
	if (uri.scheme === 'untitled') {
		return 'file';
	}
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type & vscode.FileType.Directory ? 'folder' : 'file';
	} catch {
		return 'unsupported';
	}
}

function editorContext(): EditorContext {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return { activeFileErrors: 0, hasSelection: false };
	}
	const uri = editor.document.uri;
	const activeFileErrors = vscode.languages
		.getDiagnostics(uri)
		.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
	return {
		activeFile: vscode.workspace.asRelativePath(uri),
		activeFileErrors,
		hasSelection: !editor.selection.isEmpty,
	};
}

export function activate(context: vscode.ExtensionContext): void {
	walkthroughId = `${context.extension.id}#checkTheMaps.gettingStarted`;
	const log = vscode.window.createOutputChannel('Check The MAPS', { log: true });
	context.subscriptions.push(log);

	// Local, per-day stats. Nothing is sent anywhere.
	const stats = {
		get: (): DailyStats => currentStats(context.globalState.get<DailyStats>(STATS_KEY), todayKey()),
		update: (next: DailyStats) => void context.globalState.update(STATS_KEY, next),
	};

	const statusBar = new StatusBar(COMMANDS.showMenu, () => summarize(stats.get()));
	statusBar.setVisible(config().get<boolean>('showStatusBar', true));
	context.subscriptions.push(statusBar);

	const models = new ModelResolver(() => config().get<string>('model', ''));
	context.subscriptions.push(models);

	// When the developer last clicked or typed in an editor or switched files. Putting
	// @maps back in the chat box focuses the chat, so we skip it once they've moved on.
	let lastEditorActivity = 0;
	const noteEditorActivity = () => {
		lastEditorActivity = Date.now();
	};
	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(e => {
			if (
				e.kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
				e.kind === vscode.TextEditorSelectionChangeKind.Mouse
			) {
				noteEditorActivity();
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(noteEditorActivity),
		vscode.window.onDidChangeActiveTerminal(noteEditorActivity),
	);

	const handOffs = new HandOffService(PARTICIPANT_NAME, {
		onSent: (request: HandOffRequest) => {
			if (request.reason === 'sendAnyway') {
				stats.update(recordEvent(stats.get(), 'sentAnyway', todayKey()));
			}
		},
		shouldRefill: sentAt =>
			config().get<boolean>('keepMapsInChatBox', true) && lastEditorActivity < sentAt && chatIsProbablyInView(),
		log: message => log.info(message),
	});
	context.subscriptions.push(handOffs);

	const handler = createHandler({
		settings: readSettings,
		resolveModel: () => models.resolve(),
		canSendRequest: model => context.languageModelAccessInformation.canSendRequest(model),
		editorContext,
		relativePath: uri => vscode.workspace.asRelativePath(uri),
		classifyUri,
		underDailyLimit: () => underDailyLimit(stats.get(), readSettings().dailyCheckLimit),
		record: event => stats.update(recordEvent(stats.get(), event, todayKey())),
		recordCost: usd => stats.update(addCost(stats.get(), usd, todayKey())),
		scheduleHandOff: request => handOffs.schedule(request),
		setStatus: (state, detail) => statusBar.set(state, detail),
		log: message => log.info(message),
	});

	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'participant.png');
	participant.followupProvider = createFollowupProvider(id => handOffs.release(id));
	context.subscriptions.push(
		participant,
		participant.onDidReceiveFeedback(feedback => {
			const kind = feedback.kind === vscode.ChatResultFeedbackKind.Helpful ? 'helpful' : 'unhelpful';
			const outcome = (feedback.result.metadata as { outcome?: string } | undefined)?.outcome ?? 'unknown';
			log.info(`feedback: ${kind} on a "${outcome}" result`);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMANDS.startCheckedPrompt, () => startCheckedPrompt(PARTICIPANT_NAME)),
		vscode.commands.registerCommand(COMMANDS.chooseModel, () => models.choose()),
		vscode.commands.registerCommand(COMMANDS.explain, () => explainInChat(PARTICIPANT_NAME)),
		vscode.commands.registerCommand(COMMANDS.openSettings, () =>
			vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
		),
		vscode.commands.registerCommand(COMMANDS.showLog, () => log.show()),
		vscode.commands.registerCommand(COMMANDS.handOff, (request: HandOffRequest) => handOffs.send(request)),
		vscode.commands.registerCommand(COMMANDS.resend, (id: unknown) => handOffs.resend(id)),
		vscode.commands.registerCommand(COMMANDS.toggleAutoSend, async () => {
			const next = !readSettings().autoSend;
			await config().update('autoSend', next, vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(
				next
					? 'Passing prompts will go to Copilot automatically.'
					: 'Passing prompts will wait for you to click "Send to Copilot".',
			);
		}),
		vscode.commands.registerCommand(COMMANDS.setStrictness, () => pickStrictness()),
		vscode.commands.registerCommand(COMMANDS.showMenu, () => showMenu(models, stats.get())),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(`${CONFIG_SECTION}.showStatusBar`)) {
				statusBar.setVisible(config().get<boolean>('showStatusBar', true));
			}
		}),
	);

	void welcomeOnce(context);
	log.info('Check The MAPS is ready.');
}

export function deactivate(): void {
	// Everything is disposed through context.subscriptions.
}

async function pickStrictness(): Promise<void> {
	const current = readSettings().strictness;
	const items: (vscode.QuickPickItem & { value: Strictness })[] = [
		{
			value: 'lenient',
			label: 'Lenient',
			description: 'Recommended',
			detail: 'Only flag prompts that are likely to go wrong. Fewest interruptions.',
		},
		{ value: 'balanced', label: 'Balanced', detail: 'Flag prompts that leave out something important for their size.' },
		{ value: 'strict', label: 'Strict', detail: 'Flag any prompt that skips a MAPS element its size needs. Good for learning.' },
	];
	for (const item of items) {
		if (item.value === current) {
			item.label += ' $(check)';
		}
	}
	const choice = await vscode.window.showQuickPick(items, {
		title: 'Check The MAPS: Strictness',
		placeHolder: 'How picky should the check be?',
	});
	if (choice) {
		await config().update('strictness', choice.value, vscode.ConfigurationTarget.Global);
	}
}

async function showMenu(models: ModelResolver, today: DailyStats): Promise<void> {
	const settings = readSettings();
	const modelText = await models.describeCurrent();
	type Item = vscode.QuickPickItem & { run?: () => unknown };
	const capitalized = settings.strictness[0].toUpperCase() + settings.strictness.slice(1);
	const items: Item[] = [
		{
			label: '$(comment-discussion) Start a checked prompt',
			description: 'Opens chat with @maps ready',
			run: () => vscode.commands.executeCommand(COMMANDS.startCheckedPrompt),
		},
		{ label: 'Settings', kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(symbol-misc) Checker model: ${modelText}`,
			description: 'Change',
			run: () => vscode.commands.executeCommand(COMMANDS.chooseModel),
		},
		{
			label: `$(send) Send passing prompts automatically: ${settings.autoSend ? 'On' : 'Off'}`,
			description: settings.autoSend ? 'Turn off' : 'Turn on',
			run: () => vscode.commands.executeCommand(COMMANDS.toggleAutoSend),
		},
		{
			label: `$(settings) Strictness: ${capitalized}`,
			description: 'Change',
			run: () => vscode.commands.executeCommand(COMMANDS.setStrictness),
		},
		{
			label: '$(gear) All settings',
			run: () => vscode.commands.executeCommand(COMMANDS.openSettings),
		},
		{ label: 'Help', kind: vscode.QuickPickItemKind.Separator },
		{
			label: '$(book) What is MAPS?',
			run: () => vscode.commands.executeCommand(COMMANDS.explain),
		},
		{
			label: '$(compass) Getting started',
			run: openWalkthrough,
		},
		{
			label: '$(output) Show log',
			run: () => vscode.commands.executeCommand(COMMANDS.showLog),
		},
		{ label: 'Today', kind: vscode.QuickPickItemKind.Separator },
		{ label: `$(graph) ${summarize(today)}` },
	];
	const choice = await vscode.window.showQuickPick(items, { title: 'Check The MAPS' });
	await choice?.run?.();
}

async function welcomeOnce(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(WELCOMED_KEY)) {
		return;
	}
	await context.globalState.update(WELCOMED_KEY, true);
	const choice = await vscode.window.showInformationMessage(
		'Check The MAPS is ready. Start a chat prompt with @maps and it will be checked before it goes to Copilot.',
		'Try It',
		'Show Me Around',
	);
	if (choice === 'Try It') {
		await vscode.commands.executeCommand(COMMANDS.startCheckedPrompt);
	} else if (choice === 'Show Me Around') {
		await openWalkthrough();
	}
}
