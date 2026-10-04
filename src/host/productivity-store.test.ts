import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mutateProductivitySnapshot, readProductivitySnapshot, reconcileProductivitySnapshot } from './productivity-store';

describe('productivity persistence actions', () => {
  it('serializes concurrent Todo changes so neither update overwrites the other', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-productivity-'));
    try {
      await Promise.all([
        mutateProductivitySnapshot(root, { type: 'todo.create', todo: { id: 'a', title: 'First' } }, 1),
        mutateProductivitySnapshot(root, { type: 'todo.create', todo: { id: 'b', title: 'Second' } }, 2),
      ]);
      const saved = await readProductivitySnapshot(root);
      assert.deepEqual(saved.todos.map((todo) => todo.id).sort(), ['a', 'b']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reconciles a completed focus once even when clients refresh at the same time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-productivity-'));
    try {
      await mutateProductivitySnapshot(root, { type: 'todo.create', todo: { id: 'a', title: 'First' } }, 0);
      await mutateProductivitySnapshot(root, { type: 'start', todoId: 'a' }, 1_000);
      const dueAt = 1_501_000;
      await Promise.all([
        reconcileProductivitySnapshot(root, dueAt),
        reconcileProductivitySnapshot(root, dueAt),
      ]);
      const saved = await readProductivitySnapshot(root);
      assert.equal(saved.todos[0].completedPomodoros, 1);
      assert.equal(saved.pomodoro.state.phase, 'shortBreak');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
