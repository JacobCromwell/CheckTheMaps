import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	describePrice,
	estimateCheckCostUSD,
	lookupPrice,
	normalizeModelText,
	pickCheckerModel,
	rankCheapModels,
	type ModelInfo,
} from '../src/core/models';

function model(name: string, family: string, vendor = 'copilot', id = family): ModelInfo {
	return { id, name, family, vendor };
}

const luna = model('GPT-6 Luna', 'gpt-6-luna');
const haiku55 = model('Claude Haiku 5.5', 'claude-haiku-5.5');
const mini = model('GPT-5 mini', 'gpt-5-mini');
const mini54 = model('GPT-5.4 mini', 'gpt-5.4-mini');
const opus = model('Claude Opus 5.5', 'claude-opus-5.5');
const mystery = model('Mystery Model', 'mystery-1');

describe('lookupPrice', () => {
	it('matches by family, id or display name', () => {
		assert.equal(lookupPrice(mini)?.key, 'gpt-5-mini');
		assert.equal(lookupPrice(model('GPT-5 mini', 'something-else'))?.key, 'gpt-5-mini');
		assert.equal(lookupPrice(model('x', 'y', 'copilot', 'copilot/gpt-5-mini'))?.key, 'gpt-5-mini');
	});

	it('does not confuse similar names', () => {
		assert.equal(lookupPrice(mini54)?.key, 'gpt-5.4-mini');
		assert.equal(lookupPrice(model('GPT-5.4', 'gpt-5.4'))?.key, 'gpt-5.4');
		assert.equal(lookupPrice(model('Claude Sonnet 4.6', 'claude-sonnet-4.6'))?.key, 'claude-sonnet-4.6');
		assert.equal(lookupPrice(model('Claude Sonnet 4', 'claude-sonnet-4'))?.key, 'claude-sonnet-4');
	});

	it('prefers the most specific match', () => {
		const fast = model('Claude Opus 4.8 (fast mode) (preview)', 'claude-opus-4.8-fast');
		assert.equal(lookupPrice(fast)?.key, 'claude-opus-4.8-fast-mode');
	});

	it('returns undefined for unknown models', () => {
		assert.equal(lookupPrice(mystery), undefined);
	});

	it('normalizes spacing and punctuation', () => {
		assert.equal(normalizeModelText('Claude Haiku 4.5 (Preview)'), 'claude-haiku-4.5-preview');
	});
});

describe('rankCheapModels', () => {
	it('keeps only cheap, known models, cheapest first', () => {
		const ranked = rankCheapModels([opus, mini, mystery, luna, mini54]);
		assert.deepEqual(
			ranked.map(r => r.model.name),
			['GPT-6 Luna', 'GPT-5 mini', 'GPT-5.4 mini'],
		);
	});

	it('puts Copilot models ahead of other providers at the same price', () => {
		const byok = model('Claude Haiku 5.5', 'claude-haiku-5.5', 'anthropic', 'byok-haiku');
		const ranked = rankCheapModels([byok, haiku55]);
		assert.equal(ranked[0].model.vendor, 'copilot');
	});
});

describe('pickCheckerModel', () => {
	const models = [opus, mini, luna, mystery];

	it('picks the cheapest known model automatically', () => {
		const pick = pickCheckerModel(models);
		assert.equal(pick.reason, 'auto');
		assert.equal(pick.model?.name, 'GPT-6 Luna');
	});

	it('honors a pinned model, even an expensive or unknown one', () => {
		assert.equal(pickCheckerModel(models, 'claude-opus-5.5').model?.name, 'Claude Opus 5.5');
		const pinnedMystery = pickCheckerModel(models, 'mystery-1');
		assert.equal(pinnedMystery.reason, 'pinned');
		assert.equal(pinnedMystery.price, undefined);
	});

	it('falls back to the cheapest model when the pinned one is gone', () => {
		const pick = pickCheckerModel(models, 'gone');
		assert.equal(pick.reason, 'pinned-missing');
		assert.equal(pick.model?.name, 'GPT-6 Luna');
	});

	it('never picks a premium or unknown model on its own', () => {
		const pick = pickCheckerModel([opus, mystery]);
		assert.equal(pick.reason, 'none');
		assert.equal(pick.model, undefined);
	});
});

describe('cost estimates', () => {
	it('estimates a check on a cheap model at a tiny fraction of a credit', () => {
		const price = lookupPrice(luna);
		assert.ok(price);
		const usd = estimateCheckCostUSD(price);
		assert.ok(usd > 0 && usd < 0.001, String(usd));
		assert.match(describePrice(price), /credits per check/);
	});

	it('describes unknown prices', () => {
		assert.equal(describePrice(undefined), 'price unknown');
	});
});
