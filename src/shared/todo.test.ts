import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTodo,
  deleteTodo,
  recordCompletedFocus,
  reorderTodos,
  rescheduleTodo,
  setTodoCompleted,
  updateTodo,
} from './todo';

describe('Todo domain operations', () => {
  test('creates a normalized task with stable timestamps and defaults', () => {
    const items = createTodo([], { id: 'task-1', title: '  Write docs  ' }, 100);
    assert.deepEqual(items, [
      {
        id: 'task-1',
        title: 'Write docs',
        notes: '',
        completed: false,
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        order: 0,
        createdAt: 100,
        updatedAt: 100,
        // 「待办日历」新增：不排期就是 null（显式字段，不用 undefined 表示"没设"）
        dueDate: null,
        scheduledDate: null,
        completedAt: null,
      },
    ]);
  });

  test('createTodo 支持初始日期；非法日期抛错', () => {
    const withDates = createTodo([], { id: 'd', title: 'x', dueDate: '2026-10-05', scheduledDate: '2026-10-04' }, 0);
    assert.equal(withDates[0].dueDate, '2026-10-05');
    assert.equal(withDates[0].scheduledDate, '2026-10-04');
    assert.throws(() => createTodo([], { id: 'e', title: 'x', dueDate: '2026-02-30' }, 0), /dueDate/);
    assert.throws(() => createTodo([], { id: 'f', title: 'x', scheduledDate: 'tomorrow' }, 0), /scheduledDate/);
  });

  test('完成时记 completedAt，取消完成时清掉', () => {
    const items = createTodo([], { id: 'x', title: 'Task' }, 1);
    const done = setTodoCompleted(items, 'x', true, 500);
    assert.equal(done[0].completed, true);
    assert.equal(done[0].completedAt, 500);
    const undone = setTodoCompleted(done, 'x', false, 900);
    assert.equal(undone[0].completed, false);
    assert.equal(undone[0].completedAt, null);
  });

  test('改期只动给定字段（拖拽到某天 / 清空某个日期）', () => {
    const items = createTodo([], { id: 'x', title: 'Task', dueDate: '2026-10-05' }, 1);
    const scheduled = rescheduleTodo(items, 'x', { scheduledDate: '2026-10-06' }, 2);
    assert.equal(scheduled[0].scheduledDate, '2026-10-06');
    assert.equal(scheduled[0].dueDate, '2026-10-05', '没给的字段不得被动');
    const cleared = rescheduleTodo(scheduled, 'x', { dueDate: null }, 3);
    assert.equal(cleared[0].dueDate, null);
    assert.equal(cleared[0].scheduledDate, '2026-10-06');
    assert.throws(() => rescheduleTodo(items, 'x', { dueDate: '2026-99-99' }, 4), /dueDate/);
  });

  test('rejects blank titles and invalid estimates', () => {
    assert.throws(() => createTodo([], { id: 'x', title: '   ' }, 0), /title/i);
    assert.throws(() => createTodo([], { id: 'x', title: 'Task', estimatedPomodoros: -1 }, 0), /estimate/i);
  });

  test('edits task fields without changing its creation time', () => {
    const task = createTodo([], { id: 'x', title: 'Draft' }, 10)[0];
    const updated = updateTodo([task], 'x', { title: 'Review', notes: 'Final pass' }, 20)[0];
    assert.equal(updated.title, 'Review');
    assert.equal(updated.notes, 'Final pass');
    assert.equal(updated.createdAt, 10);
    assert.equal(updated.updatedAt, 20);
  });

  test('toggles completion and increments only the linked task focus count', () => {
    const items = createTodo([], { id: 'x', title: 'Task' }, 1);
    const completed = setTodoCompleted(items, 'x', true, 2);
    const counted = recordCompletedFocus(completed, 'x', 3);
    assert.equal(counted[0].completed, true);
    assert.equal(counted[0].completedPomodoros, 1);
    assert.equal(counted[0].updatedAt, 3);
    assert.deepEqual(recordCompletedFocus(counted, 'missing', 4), counted);
  });

  test('deletes and reorders by a complete, unique id list', () => {
    let items = createTodo([], { id: 'a', title: 'A' }, 1);
    items = createTodo(items, { id: 'b', title: 'B' }, 2);
    items = reorderTodos(items, ['b', 'a'], 3);
    assert.deepEqual(
      items.map((item) => [item.id, item.order]),
      [
        ['b', 0],
        ['a', 1],
      ],
    );
    assert.throws(() => reorderTodos(items, ['a', 'a'], 4), /ids/i);
    assert.deepEqual(
      deleteTodo(items, 'b').map((item) => item.id),
      ['a'],
    );
  });
});
