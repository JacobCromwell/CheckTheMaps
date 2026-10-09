import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { countWords, looksConcrete, triage, type Strictness, type TriageInput } from '../src/core/triage';

function input(prompt: string, overrides: Partial<TriageInput> = {}): TriageInput {
	return {
		prompt,
		hasAttachments: false,
		hasSelection: false,
		activeFileHasErrors: false,
		hasEarlierTurns: false,
		strictness: 'lenient',
		...overrides,
	};
}

describe('triage: passes small, specific prompts instantly', () => {
	const passes: [string, Partial<TriageInput>?][] = [
		['rename the function helloWorld to helloDolly'],
		['change the name of the function hello world to hello dolly'],
		['Rename hello world to hello dolly'],
		['add a docstring to `parseConfig`'],
		['delete the unused import in utils.ts'],
		['convert fetch_user to async/await'],
		['make getUser private'],
		['explain parseConfig'],
		['what does useAuthToken return?'],
		['why is this slow?', { hasSelection: true }],
		['fix this', { hasSelection: true }],
		['fix the error', { activeFileHasErrors: true }],
		['fix the type error on line 42'],
		['/fix the failing test'],
		['now do the same for the tests', { hasEarlierTurns: true }],
		['also handle the empty case', { hasEarlierTurns: true }],
		['add tests for this', { hasAttachments: true }],
		['add a retry strategy to fetchUser()'],
		['write unit tests for the UserService class'],
		['document the public functions in utils.py'],
		['translate this python to go', { hasSelection: true }],
		['use async/await instead', { hasEarlierTurns: true }],
		['add GitHub login to AuthController'],
	];
	for (const [prompt, overrides] of passes) {
		it(`passes: ${prompt}`, () => {
			const result = triage(input(prompt, overrides));
			assert.equal(result.route, 'pass', result.reason);
		});
	}
});

describe('triage: sends open-ended prompts to the checker', () => {
	const checks: [string, 'task' | 'large' | 'design', Partial<TriageInput>?][] = [
		['help me design an architecture for our new app', 'design'],
		['what is the best way to handle auth?', 'design'],
		['should we use Postgres or Mongo for this?', 'design'],
		['build me a web app for tracking habits', 'design'],
		['make the service scalable to a million users', 'design'],
		['migrate our tests from Jest to Vitest', 'large'],
		['update all the endpoints to return JSON errors', 'large'],
		['add authentication', 'task'],
		['fix the bug', 'task'],
		['make it faster', 'task'],
		['why does this happen', 'task'],
		['now do the same for the tests', 'task'], // not a follow-up without earlier turns
		['add GitHub login', 'task'],
		['add MongoDB support', 'task'],
		['add GraphQL to the backend', 'task'],
		['add iOS support', 'task'],
		['update to TypeScript', 'task'],
		['add PostgreSQL', 'task'],
		['refactor parseConfig in config.ts to be easier to test', 'task'],
		['refactor the auth module', 'large'],
		['rewrite the billing service', 'large'],
		['what caching strategy should we use for product pages?', 'design'],
		['how should I structure my React app?', 'design'],
		['build a chrome extension that blocks ads', 'design'],
		['write a SQL query that returns the top customers', 'task'],
	];
	for (const [prompt, size, overrides] of checks) {
		it(`checks (${size}): ${prompt}`, () => {
			const result = triage(input(prompt, overrides));
			assert.equal(result.route, 'check');
			assert.equal(result.size, size);
		});
	}

	it('design wins over mechanical wording', () => {
		const result = triage(input('add a new microservices architecture for billing'));
		assert.equal(result.route, 'check');
		assert.equal(result.size, 'design');
	});

	it('large changes are checked even with a rename verb', () => {
		const result = triage(input('rename userId to accountId across the codebase'));
		assert.equal(result.route, 'check');
		assert.equal(result.size, 'large');
	});

	it('long mechanical prompts are checked', () => {
		const long = `rename helloWorld to helloDolly ${'and also tidy up the surrounding code a little '.repeat(4)}`;
		assert.ok(countWords(long) > 30);
		assert.equal(triage(input(long)).route, 'check');
	});
});

describe('triage: strictness', () => {
	it('strict mode checks follow-ups', () => {
		const prompt = 'now do the same for the tests';
		assert.equal(triage(input(prompt, { hasEarlierTurns: true, strictness: 'lenient' })).route, 'pass');
		assert.equal(triage(input(prompt, { hasEarlierTurns: true, strictness: 'strict' })).route, 'check');
	});

	it('word limits shrink as strictness rises', () => {
		const prompt =
			'please rename the helper function formatDate to formatIsoDate and update every caller in this file accordingly, keeping the existing behavior and comments exactly the same';
		const route = (strictness: Strictness) => triage(input(prompt, { strictness })).route;
		assert.equal(route('lenient'), 'pass');
		assert.equal(route('strict'), 'check');
	});
});

describe('looksConcrete', () => {
	it('recognizes identifiers, files, code and line numbers', () => {
		for (const text of ['fooBar', 'FooBar', 'foo_bar', 'foo()', 'src/app.ts', '`x`', '"x"', 'line 12', '#file:a.ts']) {
			assert.ok(looksConcrete(text), text);
		}
	});

	it('ignores plain prose', () => {
		for (const text of ['make it faster', 'add authentication', 'the bug']) {
			assert.ok(!looksConcrete(text), text);
		}
	});

	it('does not mistake product names for code', () => {
		for (const text of ['GitHub', 'MongoDB', 'GraphQL', 'iOS', 'macOS', 'TypeScript', 'PostgreSQL', 'eBay', 'gRPC', 'YouTube']) {
			assert.ok(!looksConcrete(`add ${text} support`), text);
		}
	});

	it('still recognizes real identifiers next to product names', () => {
		assert.ok(looksConcrete('add GitHub login to AuthController'));
		assert.ok(looksConcrete('make getUser use MongoDB'));
	});
});
