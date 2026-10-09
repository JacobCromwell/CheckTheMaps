/**
 * Picking the checker model.
 *
 * VS Code's language model API does not expose what a model costs, so we keep a
 * small price table and match the models the developer has against it. Models we
 * can't price are never picked automatically: the developer has to choose them.
 *
 * This file has no dependency on the `vscode` module so it can be unit tested.
 */

/** The parts of `vscode.LanguageModelChat` that model selection needs. */
export interface ModelInfo {
	readonly id: string;
	readonly name: string;
	readonly vendor: string;
	readonly family: string;
}

export interface PriceEntry {
	/** Normalized model key, for example `gpt-5-mini` or `claude-haiku-4.5`. */
	readonly key: string;
	/** USD per 1M input tokens (default tier). */
	readonly inputPerM: number;
	/** USD per 1M output tokens (default tier). */
	readonly outputPerM: number;
}

/**
 * Copilot model prices in USD per 1M tokens, default tier.
 * Source: GitHub Docs, "Models and pricing" for Copilot, checked 2026-10-09.
 * https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 *
 * Keep this list current when GitHub changes prices. A model that isn't listed
 * is treated as "price unknown" and is only used if the developer pins it.
 */
export const PRICE_TABLE: readonly PriceEntry[] = [
	{ key: 'gpt-6-luna', inputPerM: 0.1, outputPerM: 0.5 },
	{ key: 'claude-haiku-5.5', inputPerM: 0.1, outputPerM: 0.5 },
	{ key: 'gpt-5.6-luna', inputPerM: 0.2, outputPerM: 1.2 },
	{ key: 'mai-code-1.1-flash', inputPerM: 0.2, outputPerM: 1.2 },
	{ key: 'gpt-5.4-nano', inputPerM: 0.2, outputPerM: 1.25 },
	{ key: 'gpt-5-mini', inputPerM: 0.25, outputPerM: 2.0 },
	{ key: 'gemini-3.7-flash', inputPerM: 0.75, outputPerM: 3.75 },
	{ key: 'gemini-3.8-flash', inputPerM: 0.75, outputPerM: 3.75 },
	{ key: 'gpt-5.4-mini', inputPerM: 0.75, outputPerM: 4.5 },
	{ key: 'claude-haiku-4.5', inputPerM: 1.0, outputPerM: 5.0 },
	{ key: 'gpt-5.3-codex', inputPerM: 1.75, outputPerM: 14.0 },
	{ key: 'gpt-5.6-terra', inputPerM: 2.0, outputPerM: 12.0 },
	{ key: 'gpt-6-sol', inputPerM: 2.0, outputPerM: 10.0 },
	{ key: 'gpt-6.1-sol', inputPerM: 2.0, outputPerM: 10.0 },
	{ key: 'claude-sonnet-5', inputPerM: 2.0, outputPerM: 10.0 },
	{ key: 'claude-sonnet-5.5', inputPerM: 2.0, outputPerM: 10.0 },
	{ key: 'grok-4.5', inputPerM: 2.0, outputPerM: 6.0 },
	{ key: 'grok-4.6', inputPerM: 2.0, outputPerM: 6.0 },
	{ key: 'grok-4.7', inputPerM: 2.0, outputPerM: 6.0 },
	{ key: 'gpt-5.4', inputPerM: 2.5, outputPerM: 15.0 },
	{ key: 'claude-sonnet-4', inputPerM: 3.0, outputPerM: 15.0 },
	{ key: 'claude-sonnet-4.6', inputPerM: 3.0, outputPerM: 15.0 },
	{ key: 'kimi-k3', inputPerM: 3.0, outputPerM: 15.0 },
	{ key: 'gpt-5.6-sol', inputPerM: 4.0, outputPerM: 20.0 },
	{ key: 'claude-opus-5.5', inputPerM: 4.0, outputPerM: 20.0 },
	{ key: 'gpt-5.5', inputPerM: 5.0, outputPerM: 30.0 },
	{ key: 'claude-opus-4.8', inputPerM: 5.0, outputPerM: 25.0 },
	{ key: 'claude-opus-5', inputPerM: 5.0, outputPerM: 25.0 },
	{ key: 'claude-opus-4.8-fast-mode', inputPerM: 10.0, outputPerM: 50.0 },
	{ key: 'claude-fable-5', inputPerM: 10.0, outputPerM: 50.0 },
	{ key: 'claude-fable-5.1', inputPerM: 10.0, outputPerM: 50.0 },
	{ key: 'gpt-6-astra', inputPerM: 10.0, outputPerM: 50.0 },
];

/**
 * Models more expensive than this (USD per 1M output tokens) are never picked
 * automatically, even if nothing cheaper is available.
 */
export const AUTO_PICK_MAX_OUTPUT_PER_M = 5;

/** Rough size of one check, used for cost estimates shown to the developer. */
export const TYPICAL_CHECK_INPUT_TOKENS = 1000;
export const TYPICAL_CHECK_OUTPUT_TOKENS = 150;

export function normalizeModelText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[()]/g, ' ')
		.trim()
		.replace(/[\s_/]+/g, '-');
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `key` appears in `text` as a whole name: `gpt-5-mini` matches
 * `copilot-gpt-5-mini` but not `gpt-5.4-mini` or `gpt-5-mini2`.
 */
function containsKey(text: string, key: string): boolean {
	return new RegExp(`(^|[^a-z0-9.])${escapeRegExp(key)}($|[^a-z0-9.])`).test(text);
}

/** Finds the price for a model by its family, id or display name. */
export function lookupPrice(model: ModelInfo): PriceEntry | undefined {
	const texts = [model.family, model.id, model.name].filter(Boolean).map(normalizeModelText);
	let best: PriceEntry | undefined;
	for (const entry of PRICE_TABLE) {
		if (texts.some(text => containsKey(text, entry.key))) {
			// The longest matching key is the most specific one.
			if (!best || entry.key.length > best.key.length) {
				best = entry;
			}
		}
	}
	return best;
}

/** Estimated USD cost of one check on a model with this price. */
export function estimateCheckCostUSD(price: PriceEntry): number {
	return (TYPICAL_CHECK_INPUT_TOKENS * price.inputPerM + TYPICAL_CHECK_OUTPUT_TOKENS * price.outputPerM) / 1_000_000;
}

/** Copilot bills in AI credits; one credit is $0.01. */
export function usdToCredits(usd: number): number {
	return usd * 100;
}

export function describePrice(price: PriceEntry | undefined): string {
	if (!price) {
		return 'price unknown';
	}
	const credits = usdToCredits(estimateCheckCostUSD(price));
	return `$${price.inputPerM} in / $${price.outputPerM} out per 1M tokens · about ${credits.toFixed(credits < 0.1 ? 3 : 2)} credits per check`;
}

export interface RankedModel<T extends ModelInfo> {
	readonly model: T;
	readonly price: PriceEntry;
	readonly costUSD: number;
}

/**
 * Models that are cheap enough to pick automatically, cheapest first.
 * Copilot-provided models come before models from other providers at the same price.
 */
export function rankCheapModels<T extends ModelInfo>(models: readonly T[]): RankedModel<T>[] {
	const ranked: RankedModel<T>[] = [];
	for (const model of models) {
		const price = lookupPrice(model);
		if (price && price.outputPerM <= AUTO_PICK_MAX_OUTPUT_PER_M) {
			ranked.push({ model, price, costUSD: estimateCheckCostUSD(price) });
		}
	}
	const vendorRank = (m: ModelInfo) => (m.vendor === 'copilot' ? 0 : 1);
	return ranked.sort(
		(a, b) =>
			a.costUSD - b.costUSD ||
			vendorRank(a.model) - vendorRank(b.model) ||
			a.model.name.localeCompare(b.model.name),
	);
}

export type ModelPickReason =
	/** The developer pinned this model in settings. */
	| 'pinned'
	/** The cheapest model we know the price of. */
	| 'auto'
	/** A model is pinned but isn't available, so we fell back to the cheapest known model. */
	| 'pinned-missing'
	/** Nothing suitable is available. */
	| 'none';

export interface ModelPick<T extends ModelInfo> {
	readonly model?: T;
	readonly price?: PriceEntry;
	readonly reason: ModelPickReason;
}

export function pickCheckerModel<T extends ModelInfo>(models: readonly T[], pinnedId?: string): ModelPick<T> {
	if (pinnedId) {
		const pinned = models.find(m => m.id === pinnedId);
		if (pinned) {
			return { model: pinned, price: lookupPrice(pinned), reason: 'pinned' };
		}
	}
	const [cheapest] = rankCheapModels(models);
	if (cheapest) {
		return { model: cheapest.model, price: cheapest.price, reason: pinnedId ? 'pinned-missing' : 'auto' };
	}
	return { reason: 'none' };
}
