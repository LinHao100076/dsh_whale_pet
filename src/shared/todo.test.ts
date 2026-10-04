import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTodo, deleteTodo, recordCompletedFocus, reorderTodos, setTodoCompleted, updateTodo } from './todo';

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
      },
    ]);
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
    assert.deepEqual(items.map((item) => [item.id, item.order]), [['b', 0], ['a', 1]]);
    assert.throws(() => reorderTodos(items, ['a', 'a'], 4), /ids/i);
    assert.deepEqual(deleteTodo(items, 'b').map((item) => item.id), ['a']);
  });
});
