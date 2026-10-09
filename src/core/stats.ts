/**
 * Daily counters, kept locally in VS Code's global state. They power the daily
 * check limit and the "today" summary in the status bar menu. Nothing leaves the
 * developer's machine.
 *
 * This file has no dependency on the `vscode` module so it can be unit tested.
 */

export interface DailyStats {
	/** Local date, YYYY-MM-DD. */
	readonly day: string;
	/** Prompts that called the checker model (counts toward the daily limit). */
	readonly modelChecks: number;
	/** Prompts passed by local rules, with no model call. */
	readonly passedLocally: number;
	/** Prompts the checker model passed. */
	readonly passedByModel: number;
	/** Prompts the checker flagged. */
	readonly flagged: number;
	/** Flagged prompts the developer sent anyway. */
	readonly sentAnyway: number;
	/** Prompts sent on without a check (timeout, error, limit reached, no model). */
	readonly skipped: number;
	/** Estimated cost of today's checks in USD, from the price table and text length. */
	readonly estimatedUSD: number;
}

export type StatsEvent = Exclude<keyof DailyStats, 'day' | 'estimatedUSD'>;

export function todayKey(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function emptyStats(day: string): DailyStats {
	return {
		day,
		modelChecks: 0,
		passedLocally: 0,
		passedByModel: 0,
		flagged: 0,
		sentAnyway: 0,
		skipped: 0,
		estimatedUSD: 0,
	};
}

/** Returns today's stats, starting fresh when the stored stats are from another day. */
export function currentStats(stored: DailyStats | undefined, day: string): DailyStats {
	if (!stored || stored.day !== day) {
		return emptyStats(day);
	}
	return { ...emptyStats(day), ...stored };
}

export function recordEvent(stored: DailyStats | undefined, event: StatsEvent, day: string): DailyStats {
	const stats = currentStats(stored, day);
	return { ...stats, [event]: stats[event] + 1 };
}

export function addCost(stored: DailyStats | undefined, usd: number, day: string): DailyStats {
	const stats = currentStats(stored, day);
	return { ...stats, estimatedUSD: stats.estimatedUSD + Math.max(0, usd) };
}

/** Rough token count for cost estimates: about four characters per token. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** A limit of 0 means no limit. */
export function underDailyLimit(stats: DailyStats, limit: number): boolean {
	return limit <= 0 || stats.modelChecks < limit;
}

export function summarize(stats: DailyStats): string {
	const passed = stats.passedLocally + stats.passedByModel;
	const parts = [`${passed} passed`, `${stats.flagged} flagged`];
	if (stats.sentAnyway) {
		parts.push(`${stats.sentAnyway} sent anyway`);
	}
	if (stats.skipped) {
		parts.push(`${stats.skipped} unchecked`);
	}
	parts.push(`${stats.modelChecks} model ${stats.modelChecks === 1 ? 'call' : 'calls'}`);
	if (stats.estimatedUSD > 0) {
		// Copilot bills in AI credits; one credit is $0.01.
		const credits = stats.estimatedUSD * 100;
		parts.push(`about ${credits < 0.1 ? credits.toFixed(3) : credits.toFixed(2)} credits`);
	}
	return parts.join(' · ');
}
