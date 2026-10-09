import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	BUILT_IN_FRAMEWORKS,
	CUSTOM_FRAMEWORK_ID,
	DEFAULT_FRAMEWORK,
	MAPS,
	RISEN,
	SIZES,
	effectiveSettingValue,
	parseCustomFramework,
	resolveElementId,
	resolveFramework,
} from '../src/core/frameworks';

describe('built-in frameworks', () => {
	it('MAPS is the default', () => {
		assert.equal(DEFAULT_FRAMEWORK, MAPS);
		assert.deepEqual(MAPS.elements.map(e => e.label), ['Mission', 'Ask', 'Parameters', 'Shape']);
	});

	for (const framework of BUILT_IN_FRAMEWORKS) {
		it(`${framework.name} is consistent`, () => {
			const ids = framework.elements.map(e => e.id);
			assert.equal(new Set(ids).size, ids.length, 'ids are unique');
			assert.ok(ids.includes(framework.taskElement), 'task element exists');
			assert.deepEqual(framework.requiredBySize.small, [framework.taskElement], 'small needs only the task');
			for (const size of SIZES) {
				for (const id of framework.requiredBySize[size]) {
					assert.ok(ids.includes(id), `${size} needs ${id}, which exists`);
				}
			}
			// Bigger requests never need less than smaller ones, and every size needs the task.
			assert.ok(framework.requiredBySize.task.length <= framework.requiredBySize.large.length);
			for (const size of SIZES) {
				assert.ok(framework.requiredBySize[size].includes(framework.taskElement), `${size} needs the task`);
			}
			for (const e of framework.elements) {
				assert.ok(e.meaning.length > 10, `${e.label} has a meaning`);
				assert.doesNotMatch(e.meaning, /\.$/, 'meanings are phrases, without a closing period');
			}
		});
	}

	it('resolves labels and ids from the checker', () => {
		assert.equal(resolveElementId(RISEN, 'End goal'), 'end-goal');
		assert.equal(resolveElementId(RISEN, 'end_goal'), 'end-goal');
		assert.equal(resolveElementId(MAPS, 'PARAMETERS'), 'parameters');
		assert.equal(resolveElementId(MAPS, 'context'), undefined);
	});
});

describe('custom frameworks', () => {
	it('builds a full framework from settings', () => {
		const result = parseCustomFramework({
			name: 'Team checklist',
			elements: [
				{ id: 'ticket', label: 'Ticket', meaning: 'the issue this is for' },
				{ label: 'Change', meaning: 'what to change' },
				{ label: 'Done when', meaning: 'how we know it works', example: 'tests pass' },
			],
			taskElement: 'change',
			requiredBySize: { task: ['Change', 'ticket'], design: ['ticket', 'change', 'done-when'] },
		});
		assert.deepEqual(result.problems, []);
		const f = result.framework!;
		assert.equal(f.id, CUSTOM_FRAMEWORK_ID);
		assert.equal(f.name, 'Team checklist');
		assert.deepEqual(f.elements.map(e => e.id), ['ticket', 'change', 'done-when']);
		assert.equal(f.taskElement, 'change');
		assert.deepEqual(f.requiredBySize.small, ['change']);
		assert.deepEqual(f.requiredBySize.task, ['ticket', 'change'], 'kept in element order');
		assert.deepEqual(f.requiredBySize.large, ['ticket', 'change', 'done-when'], 'defaults to the task plus two more');
		assert.deepEqual(f.requiredBySize.design, ['ticket', 'change', 'done-when']);
	});

	it('accepts plain strings as elements and fills in defaults', () => {
		const f = parseCustomFramework({ elements: ['Goal', 'Task', 'Context', 'Format'] }).framework!;
		assert.equal(f.name, 'Custom');
		assert.equal(f.taskElement, 'task', 'a task-like part is the task element');
		assert.deepEqual(f.requiredBySize.small, ['task']);
		assert.deepEqual(f.requiredBySize.task, ['goal', 'task']);
		assert.deepEqual(f.requiredBySize.design, ['goal', 'task', 'context', 'format']);
		assert.equal(f.elements[0].meaning, '', 'no invented meaning');
	});

	it('picks a task-like part even when it is not first', () => {
		const f = parseCustomFramework({ elements: ['Mission', 'Ask', 'Parameters', 'Shape'] }).framework!;
		assert.equal(f.taskElement, 'ask');
	});

	it('always needs the task element', () => {
		const f = parseCustomFramework({
			elements: ['Goal', 'Task', 'Context'],
			taskElement: 'task',
			requiredBySize: { task: ['context'], design: ['goal'] },
		}).framework!;
		assert.deepEqual(f.requiredBySize.task, ['task', 'context']);
		assert.deepEqual(f.requiredBySize.design, ['goal', 'task']);
	});

	it('reports problems it worked around', () => {
		const result = parseCustomFramework({
			elements: [{ label: 'Goal' }, { label: 'goal' }, { meaning: 'no label' }, { label: 'Context' }],
			taskElement: 'nope',
			requiredBySize: { task: ['goal', 'missing'], large: 'goal', small: ['context'] },
		});
		assert.ok(result.framework);
		const text = result.problems.join('\n');
		assert.match(text, /"goal" is too similar to "Goal"/);
		assert.match(text, /no label/);
		assert.match(text, /taskElement "nope" isn't one of the elements, so "Context" is used/);
		assert.match(text, /requiredBySize.task mentions "missing"/);
		assert.match(text, /requiredBySize.large should be a list/);
		assert.equal(result.framework.taskElement, 'context');
	});

	it('explains ignored small requirements and a non-object requiredBySize', () => {
		const small = parseCustomFramework({ elements: ['Task', 'Context'], taskElement: 'task', requiredBySize: { small: ['context'] } });
		assert.match(small.problems.join(), /requiredBySize.small is ignored/);
		const array = parseCustomFramework({ elements: ['Task'], requiredBySize: ['task'] });
		assert.match(array.problems.join(), /requiredBySize should be an object/);
	});

	it('refuses ids and labels that the checker could confuse', () => {
		const result = parseCustomFramework({
			elements: [
				{ id: 'a', label: 'Context' },
				{ id: 'context', label: 'Background' },
				{ id: 'end-goal', label: 'End goal' },
				{ id: 'endgoal', label: 'Final goal' },
			],
		});
		assert.deepEqual(result.framework!.elements.map(e => e.id), ['a', 'end-goal']);
		assert.equal(result.problems.length, 2);
	});

	it('supports labels in any language', () => {
		const f = parseCustomFramework({ elements: ['目标', 'Überblick', 'Tâche'] }).framework!;
		assert.deepEqual(f.elements.map(e => e.id), ['目标', 'überblick', 'tâche']);
	});

	it('rejects settings that cannot work', () => {
		assert.equal(parseCustomFramework(undefined).framework, undefined);
		assert.equal(parseCustomFramework({}).framework, undefined);
		assert.equal(parseCustomFramework({ elements: [] }).framework, undefined);
		assert.equal(parseCustomFramework({ elements: [{ meaning: 'x' }] }).framework, undefined);
	});

	it('caps the number of elements', () => {
		const result = parseCustomFramework({ elements: Array.from({ length: 12 }, (_, i) => `Part ${i}`) });
		assert.equal(result.framework!.elements.length, 8);
		assert.match(result.problems.join(), /first 8/);
	});
});

describe('effectiveSettingValue', () => {
	it('takes the workspace value whole when the workspace is trusted', () => {
		const inspected = { defaultValue: {}, globalValue: { name: 'Mine' }, workspaceValue: { name: 'Team' } };
		assert.deepEqual(effectiveSettingValue(inspected, true), { name: 'Team' });
		assert.deepEqual(effectiveSettingValue(inspected, false), { name: 'Mine' });
		assert.deepEqual(effectiveSettingValue({ defaultValue: {} }, true), {});
		assert.equal(effectiveSettingValue(undefined, true), undefined);
	});
});

describe('resolveFramework', () => {
	it('finds built-ins', () => {
		assert.equal(resolveFramework('risen', undefined).framework, RISEN);
	});

	it('falls back to MAPS, explaining why', () => {
		const unknown = resolveFramework('nope', undefined);
		assert.equal(unknown.framework, MAPS);
		assert.match(unknown.problems[0], /isn't a known framework/);
		const brokenCustom = resolveFramework('custom', {});
		assert.equal(brokenCustom.framework, MAPS);
		assert.match(brokenCustom.problems.join(), /Using MAPS until/);
	});

	it('uses a valid custom framework', () => {
		const choice = resolveFramework('custom', { name: 'Ours', elements: ['Goal', 'Task'] });
		assert.equal(choice.framework.name, 'Ours');
		assert.deepEqual(choice.problems, []);
	});
});
