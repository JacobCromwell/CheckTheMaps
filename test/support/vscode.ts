import { posix } from 'node:path';

/**
 * A tiny stand-in for the `vscode` module, covering only what the participant
 * handler uses. Loaded in place of `vscode` by ./stubVscode.ts.
 */

export class Uri {
	private constructor(
		readonly scheme: string,
		readonly path: string,
	) {}
	static parse(value: string): Uri {
		const withAuthority = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(value);
		if (withAuthority) {
			return new Uri(withAuthority[1], `/${withAuthority[2].replace(/^\/+/, '')}`);
		}
		const plain = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(value);
		return plain ? new Uri(plain[1], plain[2]) : new Uri('file', value);
	}
	static file(path: string): Uri {
		return new Uri('file', path);
	}
	static joinPath(base: Uri, ...parts: string[]): Uri {
		return new Uri(base.scheme, posix.normalize(posix.join(base.path, ...parts)));
	}
	get fsPath(): string {
		return this.path;
	}
	toString(): string {
		return this.path.startsWith('/') ? `${this.scheme}://${this.path}` : `${this.scheme}:${this.path}`;
	}
}

export class Position {
	constructor(
		readonly line: number,
		readonly character: number,
	) {}
}

export class Range {
	readonly start: Position;
	readonly end: Position;
	constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
		this.start = new Position(startLine, startCharacter);
		this.end = new Position(endLine, endCharacter);
	}
}

export class Location {
	constructor(
		readonly uri: Uri,
		readonly range: Range,
	) {}
}

export class MarkdownString {
	isTrusted: boolean | { enabledCommands: readonly string[] } | undefined;
	constructor(public value = '') {}
}

export class LanguageModelChatMessage {
	private constructor(readonly content: string) {}
	static User(content: string): LanguageModelChatMessage {
		return new LanguageModelChatMessage(content);
	}
}

type Listener = () => void;

export interface StubToken {
	readonly isCancellationRequested: boolean;
	onCancellationRequested(listener: Listener): { dispose(): void };
}

export class CancellationTokenSource {
	private readonly listeners = new Set<Listener>();
	private cancelled = false;
	readonly token: StubToken;

	constructor() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const source = this;
		this.token = {
			get isCancellationRequested() {
				return source.cancelled;
			},
			onCancellationRequested(listener: Listener) {
				source.listeners.add(listener);
				return { dispose: () => source.listeners.delete(listener) };
			},
		};
	}

	cancel(): void {
		if (!this.cancelled) {
			this.cancelled = true;
			for (const listener of [...this.listeners]) {
				listener();
			}
		}
	}

	dispose(): void {
		this.listeners.clear();
	}
}

export class ChatRequestTurn {
	constructor(
		readonly prompt: string,
		readonly command: string | undefined,
		readonly references: unknown[] = [],
		readonly participant = 'check-the-maps.maps',
		readonly toolReferences: unknown[] = [],
	) {}
}

export class ChatResponseTurn {
	constructor(
		readonly response: unknown[],
		readonly result: { metadata?: Record<string, unknown> },
		readonly participant = 'check-the-maps.maps',
		readonly command?: string,
	) {}
}

// ---- Commands, window and env, recorded for hand-off tests.

export interface CommandCall {
	readonly command: string;
	readonly args: unknown[];
}

type QuickPickAnswer = (items: readonly { label: string }[]) => { label: string } | undefined;

export const recorder = {
	calls: [] as CommandCall[],
	messages: [] as string[],
	clipboard: '',
	/** Commands that should throw when executed. */
	failing: new Set<string>(),
	/** Answers for showQuickPick, used in order. */
	quickPicks: [] as QuickPickAnswer[],
	/** Button answers for show*Message, used in order. */
	buttons: [] as (string | undefined)[],
	/** Items offered by each showQuickPick call. */
	offered: [] as string[][],
	reset(): void {
		this.calls = [];
		this.messages = [];
		this.clipboard = '';
		this.failing.clear();
		this.quickPicks = [];
		this.buttons = [];
		this.offered = [];
		settings.reset();
		files.clear();
		workspace.isTrusted = true;
		workspace.workspaceFolders = undefined;
	},
};

/** Picks the first item whose label includes the text. */
export function pick(text: string): QuickPickAnswer {
	return items => items.find(item => item.label.includes(text));
}

export const commands = {
	async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
		recorder.calls.push({ command, args });
		if (recorder.failing.has(command)) {
			throw new Error(`command '${command}' not found`);
		}
		return undefined;
	},
};

export class TabInputText {
	constructor(readonly uri: Uri) {}
}
export class TabInputTextDiff {}
export class TabInputCustom {}
export class TabInputWebview {}
export class TabInputNotebook {}
export class TabInputNotebookDiff {}
export class TabInputTerminal {}

async function showMessage(message: string): Promise<string | undefined> {
	recorder.messages.push(message);
	return recorder.buttons.shift();
}

export const window = {
	tabGroups: { activeTabGroup: { activeTab: undefined as { input: unknown } | undefined } },
	showInformationMessage: showMessage,
	showWarningMessage: showMessage,
	async showQuickPick<T extends { label: string }>(items: readonly T[] | Promise<readonly T[]>): Promise<T | undefined> {
		const list = await items;
		recorder.offered.push(list.map(item => item.label));
		const answer = recorder.quickPicks.shift();
		return answer ? (answer(list) as T | undefined) : undefined;
	},
	async showWorkspaceFolderPick(): Promise<undefined> {
		return undefined;
	},
	async showTextDocument(): Promise<void> {},
};

export enum QuickPickItemKind {
	Separator = -1,
	Default = 0,
}

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

// ---- Settings: one value per scope, like VS Code (without object merging).

class SettingsStore {
	global = new Map<string, unknown>();
	workspace = new Map<string, unknown>();
	reset(): void {
		this.global.clear();
		this.workspace.clear();
	}
}
export const settings = new SettingsStore();

function configuration(section: string) {
	const full = (key: string) => `${section}.${key}`;
	return {
		get<T>(key: string, defaultValue?: T): T | undefined {
			const k = full(key);
			if (workspace.isTrusted && settings.workspace.has(k)) {
				return settings.workspace.get(k) as T;
			}
			return settings.global.has(k) ? (settings.global.get(k) as T) : defaultValue;
		},
		inspect<T>(key: string) {
			const k = full(key);
			return {
				key: k,
				defaultValue: undefined as T | undefined,
				globalValue: settings.global.get(k) as T | undefined,
				workspaceValue: settings.workspace.get(k) as T | undefined,
			};
		},
		async update(key: string, value: unknown, target: ConfigurationTarget): Promise<void> {
			const store = target === ConfigurationTarget.Global ? settings.global : settings.workspace;
			store.set(full(key), value);
		},
	};
}

// ---- An in-memory file system.

export const files = new Map<string, string>();

export class FileType {
	static readonly File = 1;
	static readonly Directory = 2;
}

export const workspace = {
	isTrusted: true,
	workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,
	getConfiguration: configuration,
	asRelativePath(uri: Uri): string {
		return uri.path.replace(/^\/workspace\//, '');
	},
	fs: {
		async readFile(uri: Uri): Promise<Uint8Array> {
			const text = files.get(uri.toString());
			if (text === undefined) {
				throw new Error(`ENOENT ${uri.toString()}`);
			}
			return new TextEncoder().encode(text);
		},
		async writeFile(uri: Uri, data: Uint8Array): Promise<void> {
			files.set(uri.toString(), new TextDecoder().decode(data));
		},
		async createDirectory(): Promise<void> {},
		async delete(uri: Uri): Promise<void> {
			files.delete(uri.toString());
		},
	},
};

export const env = {
	clipboard: {
		async writeText(text: string): Promise<void> {
			recorder.clipboard = text;
		},
	},
};
