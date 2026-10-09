/**
 * Choosing the prompt framework, and writing framework guidance into the
 * workspace's Copilot instructions.
 */

import * as vscode from 'vscode';
import {
	BUILT_IN_FRAMEWORKS,
	CUSTOM_FRAMEWORK_ID,
	DEFAULT_FRAMEWORK,
	effectiveSettingValue,
	parseCustomFramework,
	resolveFramework,
	type Framework,
	type FrameworkChoice,
} from './core/frameworks';
import {
	DamagedSectionError,
	buildGuidance,
	currentSection,
	hasSection,
	removeSection,
	sectionFrameworkId,
	upsertSection,
} from './core/instructions';
import { CONFIG_SECTION } from './modelResolver';

const FRAMEWORK_KEY = 'framework';
const CUSTOM_KEY = 'customFramework';

function config(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** The custom framework setting, taken whole from the scope that wins (objects would otherwise be merged). */
function customSettingValue(): unknown {
	return effectiveSettingValue(config().inspect<unknown>(CUSTOM_KEY), vscode.workspace.isTrusted);
}

/** The framework from settings, falling back to MAPS when the setting can't be used. */
export function currentFramework(): FrameworkChoice {
	return resolveFramework(config().get<string>(FRAMEWORK_KEY, DEFAULT_FRAMEWORK.id), customSettingValue());
}

/** True when the workspace (not just the user) sets this key, and the workspace is trusted. */
function setInWorkspace(key: string): boolean {
	return vscode.workspace.isTrusted && config().inspect(key)?.workspaceValue !== undefined;
}

/** Opens the settings JSON where a key lives (workspace or user), scrolled to that key. */
async function revealSettingJson(key: string): Promise<void> {
	const command = setInWorkspace(key) ? 'workbench.action.openWorkspaceSettingsFile' : 'workbench.action.openSettingsJson';
	await vscode.commands.executeCommand(command, { revealSetting: { key: `${CONFIG_SECTION}.${key}` } });
}

/** A starting point for teams that want their own checklist. Every part can be edited. */
const CUSTOM_TEMPLATE = {
	name: 'Our checklist',
	elements: [
		{ id: 'goal', label: 'Goal', meaning: 'why you want this, the outcome that matters' },
		{ id: 'task', label: 'Task', meaning: 'the specific change or answer you need' },
		{ id: 'context', label: 'Context', meaning: 'files, constraints, errors and what must not change' },
		{ id: 'done', label: 'Done when', meaning: "how you'll know it worked, such as which tests should pass" },
	],
	taskElement: 'task',
	requiredBySize: {
		task: ['task', 'context'],
		large: ['task', 'context', 'done'],
		design: ['goal', 'task', 'context', 'done'],
	},
};

const shownProblems = new Set<string>();

/** Shows each distinct framework problem once per session, with a way to fix it. */
export function reportFrameworkProblems(problems: readonly string[], log: (message: string) => void): void {
	for (const problem of problems) {
		log(`framework: ${problem}`);
	}
	const fresh = problems.filter(p => !shownProblems.has(p));
	if (!fresh.length) {
		return;
	}
	fresh.forEach(p => shownProblems.add(p));
	void vscode.window.showWarningMessage(`Check The MAPS: ${fresh.join(' ')}`, 'Fix It').then(choice => {
		if (choice) {
			void revealSettingJson(currentFramework().framework.id === CUSTOM_FRAMEWORK_ID ? CUSTOM_KEY : FRAMEWORK_KEY);
		}
	});
}

export async function chooseFramework(explainCommand: string): Promise<void> {
	const current = currentFramework().framework;
	const customValue = customSettingValue();
	const custom = parseCustomFramework(customValue).framework;
	const customIsSet = customValue !== undefined && !(typeof customValue === 'object' && customValue && Object.keys(customValue).length === 0);
	const mark = (id: string) => (id === current.id ? ' $(check)' : '');

	type Item = vscode.QuickPickItem & { id?: string; editCustom?: boolean };
	const describe = (f: Framework) => f.elements.map(e => e.label).join(' · ');
	const items: Item[] = BUILT_IN_FRAMEWORKS.map(f => ({
		label: `${f.title}${mark(f.id)}`,
		description: describe(f),
		detail: f.summary,
		id: f.id,
	}));
	items.push({ label: 'Your own', kind: vscode.QuickPickItemKind.Separator });
	if (custom) {
		items.push({
			label: `${custom.title}${mark(CUSTOM_FRAMEWORK_ID)}`,
			description: describe(custom),
			detail: 'Defined in the checkTheMaps.customFramework setting.',
			id: CUSTOM_FRAMEWORK_ID,
		});
	}
	if (customIsSet) {
		items.push({
			label: '$(edit) Edit your custom framework…',
			detail: custom ? undefined : "It has a problem that stops it from being used. Open it to fix it.",
			editCustom: true,
		});
	} else {
		items.push({
			label: '$(add) Define your own framework…',
			detail: 'Start from a template in settings, then rename and reword the parts to match how your team works.',
			editCustom: true,
		});
	}

	const choice = await vscode.window.showQuickPick(items, {
		title: 'Check The MAPS: Prompt Framework',
		placeHolder: 'Which checklist should prompts be checked against?',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	if (!choice) {
		return;
	}
	if (choice.editCustom) {
		if (customIsSet) {
			await revealSettingJson(CUSTOM_KEY);
		} else {
			await defineCustomFramework();
		}
		return;
	}
	if (!choice.id || choice.id === current.id) {
		return;
	}

	let target = vscode.ConfigurationTarget.Global;
	if (setInWorkspace(FRAMEWORK_KEY)) {
		// A user setting can't override the workspace, so the change has to go where the team will see it.
		const confirm = await vscode.window.showWarningMessage(
			'This workspace chooses the framework for everyone who uses it.',
			{ modal: true, detail: "Changing it updates the workspace's settings, which may be shared with your team." },
			'Change for the Workspace',
		);
		if (!confirm) {
			return;
		}
		target = vscode.ConfigurationTarget.Workspace;
	}
	await config().update(FRAMEWORK_KEY, choice.id, target);
	await announceFramework(explainCommand);
}

/** One message after a framework change, offering to explain it and to update stale guidance. */
async function announceFramework(explainCommand: string): Promise<void> {
	const framework = currentFramework().framework;
	const stale = await staleGuidance(framework);
	const explainButton = `What Is ${framework.name}?`;
	const updateButton = 'Update Guidance';
	const staleNote = stale.length
		? ` ${describeFiles(stale)} ${stale.length === 1 ? 'has' : 'have'} Copilot guidance that doesn't match ${framework.name}.`
		: '';
	const buttons = stale.length ? [updateButton, explainButton] : [explainButton];
	// Don't wait on the toast: it may never be dismissed.
	void vscode.window.showInformationMessage(`Prompts are now checked against ${framework.name}.${staleNote}`, ...buttons).then(async action => {
		if (action === explainButton) {
			await vscode.commands.executeCommand(explainCommand);
		} else if (action === updateButton) {
			await writeGuidance(stale, framework);
		}
	});
}

async function defineCustomFramework(): Promise<void> {
	const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length) && vscode.workspace.isTrusted;
	type ScopeItem = vscode.QuickPickItem & { target: vscode.ConfigurationTarget; where: string };
	const scopes: ScopeItem[] = [];
	if (hasWorkspace) {
		scopes.push({
			label: 'This workspace',
			detail: "Saved in the workspace's settings, so you can commit them and share the framework with your team.",
			target: vscode.ConfigurationTarget.Workspace,
			where: "this workspace's settings",
		});
	}
	scopes.push({
		label: 'All my workspaces',
		detail: 'Saved in your user settings.',
		target: vscode.ConfigurationTarget.Global,
		where: 'your user settings',
	});
	const scope =
		scopes.length === 1 ? scopes[0] : await vscode.window.showQuickPick(scopes, { title: 'Where should your framework live?' });
	if (!scope) {
		return;
	}
	await config().update(CUSTOM_KEY, CUSTOM_TEMPLATE, scope.target);
	await config().update(FRAMEWORK_KEY, CUSTOM_FRAMEWORK_ID, scope.target);

	if (currentFramework().framework.id === CUSTOM_FRAMEWORK_ID) {
		void vscode.window.showInformationMessage(
			`Added a starter framework to ${scope.where}. Rename the parts, reword what they mean, and choose which ones each request size needs.`,
		);
	} else {
		void vscode.window.showWarningMessage(
			`Added a starter framework to ${scope.where}, but this workspace's settings choose a different framework, so it isn't active here. Set checkTheMaps.framework to "custom" in the workspace settings to use it.`,
		);
	}
	await revealSettingJson(CUSTOM_KEY);
}

// ---------------------------------------------------------------- Copilot instructions

interface InstructionsTarget {
	readonly label: string;
	readonly path: readonly string[];
	readonly detail: string;
}

const INSTRUCTION_TARGETS: readonly InstructionsTarget[] = [
	{
		label: '.github/copilot-instructions.md',
		path: ['.github', 'copilot-instructions.md'],
		detail: 'Copilot reads this on every chat request. Recommended.',
	},
	{
		label: 'AGENTS.md',
		path: ['AGENTS.md'],
		detail: 'Read by other coding agents, and by Copilot when AGENTS.md support (chat.useAgentsMdFile) is on.',
	},
];

function describeFiles(uris: readonly vscode.Uri[]): string {
	const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
	const names = uris.map(uri => vscode.workspace.asRelativePath(uri, multiRoot));
	if (names.length <= 1) {
		return names.join('');
	}
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length <= 1) {
		return folders[0];
	}
	return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Which folder should get the guidance?' });
}

/** Instructions files in the folder that already have a Check The MAPS section. */
async function filesWithGuidance(folder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
	const found: vscode.Uri[] = [];
	for (const target of INSTRUCTION_TARGETS) {
		const uri = vscode.Uri.joinPath(folder.uri, ...target.path);
		const text = await readText(uri);
		if (text !== undefined && hasSection(text)) {
			found.push(uri);
		}
	}
	return found;
}

/** Files whose guidance doesn't match the framework's current guidance. */
async function staleGuidance(framework: Framework): Promise<vscode.Uri[]> {
	const fresh = buildGuidance(framework);
	const stale: vscode.Uri[] = [];
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		for (const uri of await filesWithGuidance(folder)) {
			const text = (await readText(uri)) ?? '';
			if (currentSection(text) !== fresh && sectionFrameworkId(text) !== undefined) {
				stale.push(uri);
			}
		}
	}
	return stale;
}

/**
 * Writes (or removes) guidance in each file. Damaged markers are reported rather
 * than "fixed", so nothing the developer wrote is lost.
 */
async function writeGuidance(uris: readonly vscode.Uri[], framework: Framework | undefined): Promise<boolean> {
	for (const uri of uris) {
		const text = (await readText(uri)) ?? '';
		try {
			if (framework) {
				await writeText(uri, upsertSection(text, buildGuidance(framework)));
			} else {
				const remaining = removeSection(text);
				if (remaining.trim()) {
					await writeText(uri, remaining);
				} else {
					await vscode.workspace.fs.delete(uri);
				}
			}
		} catch (error) {
			if (error instanceof DamagedSectionError) {
				const open = await vscode.window.showWarningMessage(`${describeFiles([uri])}: ${error.message}`, 'Open File');
				if (open) {
					await vscode.window.showTextDocument(uri);
				}
				return false;
			}
			throw error;
		}
	}
	return true;
}

/** Adds, updates or removes the framework guidance in the workspace's instructions file. */
export async function manageInstructionsGuidance(): Promise<void> {
	const folder = await pickFolder();
	if (!folder) {
		void vscode.window.showInformationMessage('Open a folder first, so there is somewhere to add the guidance.');
		return;
	}
	const framework = currentFramework().framework;
	const existing = await filesWithGuidance(folder);

	if (existing.length) {
		const files = describeFiles(existing);
		const choice = await vscode.window.showQuickPick(
			[
				{ label: `$(sync) Update to ${framework.name}`, detail: `Rewrite the guidance in ${files}.`, action: 'update' as const },
				{
					label: '$(trash) Remove the guidance',
					detail: `Take it out of ${files}, leaving the rest of the file as it is.`,
					action: 'remove' as const,
				},
			],
			{ title: 'Check The MAPS: Copilot Instructions' },
		);
		if (!choice) {
			return;
		}
		const done = await writeGuidance(existing, choice.action === 'update' ? framework : undefined);
		if (done) {
			void vscode.window.showInformationMessage(
				choice.action === 'update' ? `Updated the guidance in ${files}.` : `Removed the guidance from ${files}.`,
			);
		}
		return;
	}

	const target = await vscode.window.showQuickPick(
		INSTRUCTION_TARGETS.map(t => ({ ...t })),
		{
			title: `Add ${framework.name} guidance to your instructions`,
			placeHolder: 'Copilot will be asked to check requests against your framework and keep answers in scope',
		},
	);
	if (!target) {
		return;
	}
	const uri = vscode.Uri.joinPath(folder.uri, ...target.path);
	if (!(await writeGuidance([uri], framework))) {
		return;
	}
	await vscode.window.showTextDocument(uri, { preview: true });
	void vscode.window.showInformationMessage(
		`Added ${framework.name} guidance to ${target.label}. Commit it to share it with your team.`,
	);
	if (target.path[0] === '.github') {
		warnIfInstructionsAreOff();
	}
}

/** Copilot can be told to ignore its instructions file; point that out instead of failing silently. */
function warnIfInstructionsAreOff(): void {
	const section = vscode.workspace.getConfiguration('github.copilot.chat.codeGeneration');
	if (section.get<boolean>('useInstructionFiles') !== false) {
		return;
	}
	void vscode.window
		.showWarningMessage(
			"Copilot is set to ignore .github/copilot-instructions.md (github.copilot.chat.codeGeneration.useInstructionFiles is off), so the guidance won't be used.",
			'Turn It On',
		)
		.then(choice => {
			if (!choice) {
				return;
			}
			// Turn it on where it was turned off, or the other scope would still win.
			const inspected = section.inspect<boolean>('useInstructionFiles');
			const target =
				inspected?.workspaceValue === false ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
			void section.update('useInstructionFiles', true, target);
		});
}
