import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	addCost,
	currentStats,
	emptyStats,
	estimateTokens,
	recordEvent,
	summarize,
	todayKey,
	underDailyLimit,
} from '../src/core/stats';

describe('daily stats', () => {
	it('formats the local date', () => {
		assert.equal(todayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
	});

	it('starts fresh on a new day', () => {
		const yesterday = recordEvent(undefined, 'modelChecks', '2026-10-08');
		assert.equal(yesterday.modelChecks, 1);
		assert.equal(currentStats(yesterday, '2026-10-09').modelChecks, 0);
	});

	it('counts events and cost', () => {
		let stats = recordEvent(undefined, 'passedLocally', 'd');
		stats = recordEvent(stats, 'passedByModel', 'd');
		stats = recordEvent(stats, 'flagged', 'd');
		stats = recordEvent(stats, 'sentAnyway', 'd');
		stats = addCost(stats, 0.0002, 'd');
		assert.equal(summarize(stats), '2 passed · 1 flagged · 1 sent anyway · 0 model calls · about 0.020 credits');
	});

	it('fills in fields added in later versions', () => {
		const old = { day: 'd', modelChecks: 3 } as unknown as ReturnType<typeof emptyStats>;
		assert.equal(currentStats(old, 'd').estimatedUSD, 0);
	});

	it('enforces the daily limit, with 0 meaning no limit', () => {
		const stats = { ...emptyStats('d'), modelChecks: 5 };
		assert.equal(underDailyLimit(stats, 5), false);
		assert.equal(underDailyLimit(stats, 6), true);
		assert.equal(underDailyLimit(stats, 0), true);
	});

	it('estimates tokens from length', () => {
		assert.equal(estimateTokens('abcd'), 1);
		assert.equal(estimateTokens('abcde'), 2);
	});
});
