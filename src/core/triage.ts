/**
 * Local triage: fast rules that run before any model call.
 *
 * Obviously small prompts ("rename helloWorld to helloDolly") pass instantly with
 * no model call and no delay. Everything else goes to the checker model, along
 * with a hint about how big the request looks.
 *
 * The rules lean toward passing. A false alarm costs the developer more than a
 * vague prompt slipping through, so when in doubt, small-looking prompts pass.
 *
 * This file has no dependency on the `vscode` module so it can be unit tested.
 */

export type Strictness = 'lenient' | 'balanced' | 'strict';

/** How big the request is. Bigger requests need more of MAPS. */
export type RequestSize = 'small' | 'task' | 'large' | 'design';

export interface TriageInput {
	readonly prompt: string;
	/** Files, symbols or other references attached to the prompt. */
	readonly hasAttachments: boolean;
	/** Code is selected in the active editor. */
	readonly hasSelection: boolean;
	/** The active file has errors, so "fix this" has something to point at. */
	readonly activeFileHasErrors: boolean;
	/** The developer has used @maps earlier in this chat, so this may be a follow-up. */
	readonly hasEarlierTurns: boolean;
	readonly strictness: Strictness;
}

export interface TriageResult {
	readonly route: 'pass' | 'check';
	readonly size: RequestSize;
	/** Short, developer-facing reason, used in logs and in /check output. */
	readonly reason: string;
}

interface Limits {
	/** Max words for a mechanical edit to pass without a model check. */
	readonly mechanicalWords: number;
	/** Max words for a question about attached or selected code to pass. */
	readonly questionWords: number;
	/** Max words for a follow-up to pass. 0 means follow-ups are always checked. */
	readonly followUpWords: number;
}

const LIMITS: Record<Strictness, Limits> = {
	lenient: { mechanicalWords: 30, questionWords: 25, followUpWords: 20 },
	balanced: { mechanicalWords: 25, questionWords: 20, followUpWords: 12 },
	strict: { mechanicalWords: 18, questionWords: 15, followUpWords: 0 },
};

/** Open-ended design, architecture and technology-choice requests. */
const DESIGN_RE =
	/\b(architect(ure|ing)?|system design|design (a|an|the|our|my) |scal(able|ability|e to|ing to)|microservices?|from scratch|greenfield|tech(nology)? stack|which (framework|library|database|db|language|approach|pattern)|should (i|we) use|best (way|approach|practice)|trade-?offs?|infrastructure|data model|schema design|roadmap|(caching|testing|branching|deployment|scaling|migration|backup|rollout|release|versioning|data|auth\w*|security|monitoring|logging|error[- ]handling) strategy|plan (out|for)|how (should|do) (i|we) (structure|organi[sz]e|architect|lay out)|(build|create|make) (me )?(a|an) ([\w-]+ ){0,3}(app|application|service|platform|website|site|backend|system|game|saas|product|extension|plugin|bot|cli|dashboard|library))\b/i;

/** Sweeping changes: always multi-file. */
const LARGE_RE =
	/\b(re-architect|migrat(e|ion)|port (this|the|it|our|my) .*\bto\b|upgrade (to|from)|across (the |our |my )?(whole |entire )?(codebase|project|repo|app)|all (the |our )?(files|components|modules|tests|endpoints|services)|every (file|component|module|test|endpoint|service))\b/i;

/** Restructuring verbs: multi-file unless the prompt names a specific target. */
const RESTRUCTURE_RE = /\b(refactor|restructure|rewrite|reorgani[sz]e)\b/i;

/** Starts with a mechanical edit verb. */
const MECHANICAL_RE =
	/^(please\s+|can you\s+|could you\s+)?(rename|change|replace|delete|remove|add|insert|move|format|sort|indent|uncomment|comment( out)?|bump|update|fix (the )?typos?|convert|extract|inline|wrap|unwrap|make|mark|set|swap|reorder|capitali[sz]e|lowercase|uppercase|import|export|undo|revert|translate|document|use|enable|disable|write (unit |integration |e2e )?tests? for|add (docs|docstrings|comments|jsdoc|types|type hints) (to|for))\b/i;

/** "rename X to Y" or "change the name of X to Y": specific even without code formatting. */
const RENAME_RE = /^(please\s+|can you\s+|could you\s+)?(rename|change the name of)\b.+\bto\b.+/i;

/** Starts like a fix or debug request. */
const FIX_RE = /^(please\s+|can you\s+|could you\s+)?(fix|debug|solve|resolve)\b/i;

/** Starts like a question or an explain request. */
const QUESTION_RE =
	/^(what|why|how|where|when|which|who|explain|describe|summari[sz]e|walk me through|tell me|is|are|does|do|can|could|would)\b/i;

/** Starts like a follow-up to an earlier turn, or refers back to it ("use a Map instead"). */
const FOLLOW_UP_RE =
	/^(now|also|and|then|next|same|do the same|again|instead|actually|ok(ay)?|great|thanks|thank you|perfect|nice|yes|no|nope|yep|sure|go ahead|continue|keep going|try again|undo|revert|that|those|these|it)\b|\b(instead|as well|the same( way)?|like before)\b/i;

/**
 * Product and technology names that look like code identifiers but aren't:
 * "add GitHub login" is a feature request, not an edit to a symbol.
 */
const PRODUCT_NAMES = new Set(
	[
		'ActiveMQ', 'AngularJS', 'AppSync', 'AutoGen', 'BigQuery', 'BitBucket', 'ChatGPT', 'CircleCI', 'CloudFlare',
		'CloudFormation', 'CloudFront', 'CloudWatch', 'CocoaPods', 'CodeQL', 'CoffeeScript', 'CosmosDB', 'CouchDB',
		'DevOps', 'DevTools', 'DigitalOcean', 'DynamoDB', 'ElasticSearch', 'FastAPI', 'FireStore', 'GitHub', 'GitLab',
		'GitOps', 'GraphQL', 'HubSpot', 'HuggingFace', 'IntelliJ', 'JavaScript', 'JetBrains', 'JUnit', 'LangChain',
		'LinkedIn', 'LlamaIndex', 'MariaDB', 'MLOps', 'MongoDB', 'MySQL', 'NestJS', 'NextJS', 'NodeJS', 'NoSQL',
		'NumPy', 'NuGet', 'OAuth', 'OneDrive', 'OpenAI', 'OpenAPI', 'OpenSearch', 'OpenTelemetry', 'PayPal',
		'PlayStation', 'PostCSS', 'PostgreSQL', 'PowerShell', 'PyCharm', 'PyPI', 'PyTest', 'PyTorch', 'QuickBooks',
		'RabbitMQ', 'ReactJS', 'SageMaker', 'SciPy', 'SharePoint', 'SignalR', 'SvelteKit', 'SwiftUI', 'TailwindCSS',
		'TensorFlow', 'TypeScript', 'VSCode', 'VueJS', 'WebAssembly', 'WebGL', 'WebRTC', 'WebSocket', 'WebSockets',
		'WebStorm', 'WordPress', 'YouTube', 'ZeroMQ',
	].map(name => name.toLowerCase()),
);

/** camelCase with a real lowercase prefix (fetchUser, getUser), which rules out iOS, eBay and gRPC. */
const CAMEL_CASE_RE = /^[a-z]{2,}[A-Z][a-z0-9]+[A-Za-z0-9]*$/;
const PASCAL_CASE_RE = /^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/;

/**
 * Verbs that often introduce a new dependency or feature ("add NextAuth",
 * "set up KeyCloak"). After these, a capitalized name is more likely a product
 * than a symbol in the code, so only a named target ("... to parseConfig") counts.
 */
const INTEGRATION_RE =
	/^(please\s+|can you\s+|could you\s+)?(add|integrate|set ?up|install|use|switch to|support|enable|configure|implement)\b/i;

/** An identifier in target position: "to parseConfig", "in AuthController". */
const TARGET_RE = /\b(?:to|in|into|for|on|inside|within|from|of)\s+(?:the\s+|a\s+|an\s+|our\s+|my\s+)?([A-Za-z_$][\w$]*)/gi;

/**
 * Something concrete the agent can locate: backticked code, a quoted string,
 * snake_case, call syntax, a file name, a line number or a chat reference.
 * camelCase and PascalCase identifiers are checked separately, to skip product names.
 */
const CONCRETE_PATTERNS: readonly RegExp[] = [
	/`[^`]+`/,
	/"[^"\s][^"]*"|'[^'\s][^']*'/,
	/\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/, // snake_case
	/\b[A-Za-z_$][\w$.]*\(\)/, // call syntax
	/\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|swift|php|json|ya?ml|toml|md|css|scss|html|vue|svelte|sql|sh|ps1)\b/i,
	/\blines? \d+/i,
	/#[\w.:/-]+/, // chat references such as #file:foo.ts or #selection
];

export function countWords(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

function isCodeIdentifier(word: string): boolean {
	return (CAMEL_CASE_RE.test(word) || PASCAL_CASE_RE.test(word)) && !PRODUCT_NAMES.has(word.toLowerCase());
}

export function looksConcrete(text: string): boolean {
	if (CONCRETE_PATTERNS.some(re => re.test(text))) {
		return true;
	}
	if (INTEGRATION_RE.test(text.trim())) {
		return [...text.matchAll(TARGET_RE)].some(match => isCodeIdentifier(match[1]));
	}
	return (text.match(/[A-Za-z_$][\w$]*/g) ?? []).some(isCodeIdentifier);
}

export function triage(input: TriageInput): TriageResult {
	const prompt = input.prompt.trim();
	const limits = LIMITS[input.strictness];
	const words = countWords(prompt);
	const hasContext = input.hasAttachments || input.hasSelection;

	if (prompt.startsWith('/')) {
		return { route: 'pass', size: 'small', reason: 'Copilot slash command' };
	}

	if (DESIGN_RE.test(prompt)) {
		return { route: 'check', size: 'design', reason: 'design or architecture request' };
	}

	if (LARGE_RE.test(prompt)) {
		return { route: 'check', size: 'large', reason: 'multi-file change' };
	}

	const concrete = looksConcrete(prompt) || hasContext;

	if (RESTRUCTURE_RE.test(prompt)) {
		// "refactor parseConfig in config.ts" is a task; "refactor the auth module" may span many files.
		return concrete
			? { route: 'check', size: 'task', reason: 'focused restructuring' }
			: { route: 'check', size: 'large', reason: 'restructuring' };
	}

	if (RENAME_RE.test(prompt) && words <= limits.mechanicalWords) {
		return { route: 'pass', size: 'small', reason: 'rename' };
	}

	if (MECHANICAL_RE.test(prompt) && concrete && words <= limits.mechanicalWords) {
		return { route: 'pass', size: 'small', reason: 'small, specific edit' };
	}

	if (FIX_RE.test(prompt) && (concrete || input.activeFileHasErrors) && words <= limits.questionWords) {
		return { route: 'pass', size: 'small', reason: 'fix with the code in view' };
	}

	if (QUESTION_RE.test(prompt) && concrete && words <= limits.questionWords) {
		return { route: 'pass', size: 'small', reason: 'question about specific code' };
	}

	if (
		limits.followUpWords > 0 &&
		input.hasEarlierTurns &&
		FOLLOW_UP_RE.test(prompt) &&
		words <= limits.followUpWords
	) {
		return { route: 'pass', size: 'task', reason: 'follow-up to the conversation' };
	}

	return { route: 'check', size: 'task', reason: 'needs a closer look' };
}
