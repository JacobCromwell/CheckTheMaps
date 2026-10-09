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

export const recorder = {
	calls: [] as CommandCall[],
	messages: [] as string[],
	clipboard: '',
	/** Commands that should throw when executed. */
	failing: new Set<string>(),
	reset(): void {
		this.calls = [];
		this.messages = [];
		this.clipboard = '';
		this.failing.clear();
	},
};

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

export const window = {
	tabGroups: { activeTabGroup: { activeTab: undefined as { input: unknown } | undefined } },
	async showInformationMessage(message: string): Promise<undefined> {
		recorder.messages.push(message);
		return undefined;
	},
	async showWarningMessage(message: string): Promise<undefined> {
		recorder.messages.push(message);
		return undefined;
	},
};

export const env = {
	clipboard: {
		async writeText(text: string): Promise<void> {
			recorder.clipboard = text;
		},
	},
};
