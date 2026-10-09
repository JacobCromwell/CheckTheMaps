/**
 * A small status bar item: a map icon at rest, a green check after a passing
 * prompt, a warning after a flagged one. Clicking it opens the menu.
 */

import * as vscode from 'vscode';
import type { StatusState } from './participant';

/** How long a result stays visible before the item goes back to rest. */
const RESULT_VISIBLE_MS = 15_000;

interface Look {
	readonly icon: string;
	readonly color?: vscode.ThemeColor;
	readonly title: string;
}

const LOOKS: Record<StatusState, Look> = {
	idle: { icon: '$(map)', title: 'Ready' },
	checking: { icon: '$(loading~spin)', title: 'Checking your prompt…' },
	passed: { icon: '$(pass-filled)', color: new vscode.ThemeColor('testing.iconPassed'), title: 'Last prompt passed' },
	flagged: { icon: '$(warning)', color: new vscode.ThemeColor('editorWarning.foreground'), title: 'Last prompt needs details' },
	unchecked: { icon: '$(debug-step-over)', title: 'Last prompt was sent unchecked' },
};

export class StatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private resetTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		command: string,
		private readonly summary: () => string,
	) {
		this.item = vscode.window.createStatusBarItem('checkTheMaps.status', vscode.StatusBarAlignment.Right, 100);
		this.item.name = 'Check The MAPS';
		this.item.command = command;
		this.set('idle');
	}

	setVisible(visible: boolean): void {
		if (visible) {
			this.item.show();
		} else {
			this.item.hide();
		}
	}

	set(state: StatusState, detail?: string): void {
		if (this.resetTimer) {
			clearTimeout(this.resetTimer);
			this.resetTimer = undefined;
		}
		const look = LOOKS[state];
		this.item.text = `${look.icon} MAPS`;
		this.item.color = look.color;
		this.item.accessibilityInformation = { label: `Check The MAPS: ${look.title}` };

		const tooltip = new vscode.MarkdownString(undefined, true);
		tooltip.appendMarkdown(`**Check The MAPS**: ${look.title}`);
		if (detail) {
			tooltip.appendMarkdown('\n\n');
			tooltip.appendText(detail);
		}
		tooltip.appendMarkdown(`\n\nToday: ${this.summary()}\n\nClick for options.`);
		this.item.tooltip = tooltip;

		if (state !== 'idle' && state !== 'checking') {
			this.resetTimer = setTimeout(() => this.set('idle'), RESULT_VISIBLE_MS);
		}
	}

	dispose(): void {
		if (this.resetTimer) {
			clearTimeout(this.resetTimer);
		}
		this.item.dispose();
	}
}
