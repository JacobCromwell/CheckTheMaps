/**
 * Finds the checker model among the models VS Code offers, and lets the
 * developer choose one.
 */

import * as vscode from 'vscode';
import {
	AUTO_PICK_MAX_OUTPUT_PER_M,
	describePrice,
	estimateCheckCostUSD,
	lookupPrice,
	pickCheckerModel,
	rankCheapModels,
	usdToCredits,
} from './core/models';
import type { CheckerModel, NoCheckerModel } from './participant';

export const CONFIG_SECTION = 'checkTheMaps';

function modelLabel(model: vscode.LanguageModelChat): string {
	return model.name || model.family || model.id;
}

export class ModelResolver implements vscode.Disposable {
	private models: vscode.LanguageModelChat[] | undefined;
	private readonly listener: vscode.Disposable;
	/** The label of the model used most recently, for the status bar. */
	lastLabel: string | undefined;

	constructor(private readonly getPinnedId: () => string) {
		this.listener = vscode.lm.onDidChangeChatModels(() => {
			this.models = undefined;
		});
	}

	private async allModels(refresh = false): Promise<vscode.LanguageModelChat[]> {
		if (!this.models || refresh) {
			this.models = await vscode.lm.selectChatModels();
		}
		return this.models;
	}

	async resolve(): Promise<CheckerModel | NoCheckerModel> {
		const models = await this.allModels();
		const pinnedId = this.getPinnedId();
		const pick = pickCheckerModel(models, pinnedId || undefined);
		if (!pick.model) {
			return {
				note: models.length
					? "None of your models has a known low price, and Check The MAPS won't pick a premium model on its own."
					: 'No language models are available yet. Is GitHub Copilot signed in?',
			};
		}
		const label = modelLabel(pick.model);
		this.lastLabel = label;
		return {
			model: pick.model,
			label,
			price: pick.price,
			note:
				pick.reason === 'pinned-missing'
					? `Your chosen checker model isn't available right now, so ${label} checked this prompt.`
					: undefined,
		};
	}

	/** Describes the current choice for menus, without calling any model. */
	async describeCurrent(): Promise<string> {
		const models = await this.allModels();
		const pinnedId = this.getPinnedId();
		const pick = pickCheckerModel(models, pinnedId || undefined);
		if (!pick.model) {
			return 'none available';
		}
		return pick.reason === 'pinned' ? modelLabel(pick.model) : `${modelLabel(pick.model)} (automatic)`;
	}

	/** Shows a picker of all available models with their cost per check. */
	async choose(): Promise<void> {
		const models = await this.allModels(true);
		if (!models.length) {
			void vscode.window.showInformationMessage(
				'No language models are available. Sign in to GitHub Copilot (or add a model provider), then try again.',
			);
			return;
		}

		type Item = vscode.QuickPickItem & { modelId?: string; costly?: boolean };
		const pinnedId = this.getPinnedId();
		const ranked = rankCheapModels(models);
		const rankedIds = new Set(ranked.map(r => r.model.id));
		const current = (id: string) => (id === pinnedId ? ' $(check)' : '');

		const items: Item[] = [
			{
				label: `$(sparkle) Automatic${current('')}`,
				description: ranked[0] ? `currently ${modelLabel(ranked[0].model)}` : 'no low-cost model available',
				detail: 'Always use the cheapest model with a known price. Recommended.',
				modelId: '',
			},
		];

		if (ranked.length) {
			items.push({ label: 'Low cost', kind: vscode.QuickPickItemKind.Separator });
			for (const r of ranked) {
				items.push({
					label: `${modelLabel(r.model)}${current(r.model.id)}`,
					description: r.model.vendor,
					detail: describePrice(r.price),
					modelId: r.model.id,
				});
			}
		}

		const others = models
			.filter(m => !rankedIds.has(m.id))
			.sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
		if (others.length) {
			items.push({ label: 'Other models', kind: vscode.QuickPickItemKind.Separator });
			for (const model of others) {
				const price = lookupPrice(model);
				items.push({
					label: `${modelLabel(model)}${current(model.id)}`,
					description: model.vendor,
					detail: price ? `$(warning) ${describePrice(price)}` : 'Price unknown',
					modelId: model.id,
					costly: !price || price.outputPerM > AUTO_PICK_MAX_OUTPUT_PER_M,
				});
			}
		}

		const choice = await vscode.window.showQuickPick(items, {
			title: 'Check The MAPS: Checker Model',
			placeHolder: 'Choose the model that checks your prompts',
			matchOnDescription: true,
		});
		if (!choice || choice.modelId === undefined) {
			return;
		}

		if (choice.costly) {
			const model = models.find(m => m.id === choice.modelId);
			const price = model ? lookupPrice(model) : undefined;
			const cheapest = ranked[0];
			let detail = `We don't know what ${choice.label.replace(' $(check)', '')} costs, so its checks could be expensive.`;
			if (price && cheapest) {
				const ratio = estimateCheckCostUSD(price) / cheapest.costUSD;
				detail = `Each check would cost about ${usdToCredits(estimateCheckCostUSD(price)).toFixed(2)} credits, roughly ${Math.round(ratio)}× the cheapest option (${modelLabel(cheapest.model)}).`;
			}
			const confirm = await vscode.window.showWarningMessage(
				'Use a costly model for prompt checks?',
				{ modal: true, detail },
				'Use It Anyway',
			);
			if (confirm !== 'Use It Anyway') {
				return;
			}
		}

		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update('model', choice.modelId, vscode.ConfigurationTarget.Global);
		const chosen = choice.modelId ? choice.label.replace(' $(check)', '') : 'the cheapest available model';
		void vscode.window.showInformationMessage(`Check The MAPS will use ${chosen} to check prompts.`);
	}

	dispose(): void {
		this.listener.dispose();
	}
}
