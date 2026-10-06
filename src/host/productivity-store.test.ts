import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  focusCompletions,
  mutateProductivitySnapshot,
  readProductivitySnapshot,
  reconcileProductivitySnapshot,
  reconcileProductivitySnapshotWithBefore,
} from './productivity-store';

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

  it('并发刷新时一个专注周期只计一次（周期数不重复累加）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-productivity-'));
    try {
      await mutateProductivitySnapshot(root, { type: 'todo.create', todo: { id: 'a', title: 'First' } }, 0);
      await mutateProductivitySnapshot(root, { type: 'start', todoId: 'a' }, 1_000);
      const dueAt = 1_501_000;
      await Promise.all([reconcileProductivitySnapshot(root, dueAt), reconcileProductivitySnapshot(root, dueAt)]);
      const saved = await readProductivitySnapshot(root);
      assert.equal(saved.pomodoro.state.completedFocusCycles, 1);
      assert.equal(saved.pomodoro.state.phase, 'shortBreak');
      // 待办已独立存储：这里不再改遗留 todos（番茄数由 host 的 recordTodoFocus 记进 todos.json）
      assert.equal(saved.todos[0].completedPomodoros, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('focusCompletions：从**动作前**的快照取关联任务（完成后 state.todoId 已被清空）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-productivity-'));
    try {
      await mutateProductivitySnapshot(root, { type: 'start', todoId: 'linked-1' }, 1_000);
      const { before, after } = await reconcileProductivitySnapshotWithBefore(root, 1_501_000);
      const completion = focusCompletions(before, after);
      assert.deepEqual(completion, { todoId: 'linked-1', count: 1 });
      // 完成之后新状态里的引用已经清空——这正是必须看 before 的原因
      assert.equal(after.pomodoro.state.todoId, null);
      // 没有跨周期 → 不记
      assert.deepEqual(focusCompletions(after, after), { todoId: null, count: 0 });
      // 没关联任务 → todoId 为 null，调用方据此不记。
      // 先 reset 回到专注阶段，再推进**完整的**专注时长（默认 25 分钟）：
      // 之前这里是"推进 400 秒"，而那时正在跑休息阶段——休息跑完不算专注周期，于是断言必然失败。
      await mutateProductivitySnapshot(root, { type: 'reset' }, 3_000_000);
      await mutateProductivitySnapshot(root, { type: 'start', todoId: null }, 3_000_000);
      const plain = await reconcileProductivitySnapshotWithBefore(root, 3_000_000 + 25 * 60 * 1000 + 1);
      assert.deepEqual(focusCompletions(plain.before, plain.after), { todoId: null, count: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
