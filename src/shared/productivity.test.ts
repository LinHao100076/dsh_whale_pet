import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyProductivityAction, createProductivitySnapshot, productivityBubbleText } from './productivity';

describe('productivity actions', () => {
  it('formats the active phase, remaining time, and linked Todo for the pet bubble', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(
      snapshot,
      { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests', estimatedPomodoros: 3 } },
      0,
    );
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);
    assert.equal(productivityBubbleText(snapshot, 61_000), '专注中 24:00 · Write tests 0/3');

    const hidden = {
      ...snapshot,
      pomodoro: { ...snapshot.pomodoro, settings: { ...snapshot.pomodoro.settings, showBubble: false } },
    };
    assert.equal(productivityBubbleText(hidden, 61_000), null);
    assert.equal(productivityBubbleText(createProductivitySnapshot(), 1_000), null);
  });

  it('starts, pauses, resumes, and resets the shared timer', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: null }, 1_000);
    assert.equal(snapshot.pomodoro.state.running, true);
    assert.equal(snapshot.pomodoro.state.endsAt, 1_501_000);

    snapshot = applyProductivityAction(snapshot, { type: 'pause' }, 61_000);
    assert.equal(snapshot.pomodoro.state.remainingSeconds, 1_440);
    assert.equal(snapshot.pomodoro.state.running, false);

    snapshot = applyProductivityAction(snapshot, { type: 'resume' }, 100_000);
    assert.equal(snapshot.pomodoro.state.endsAt, 1_540_000);
    snapshot = applyProductivityAction(snapshot, { type: 'reset' }, 101_000);
    assert.equal(snapshot.pomodoro.state.phase, 'focus');
    assert.equal(snapshot.pomodoro.state.running, false);
    assert.equal(snapshot.pomodoro.state.remainingSeconds, 1_500);
  });

  it('专注周期结束时不再自己给待办记番茄数（待办已独立存储）', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(
      snapshot,
      { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests' } },
      0,
    );
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);

    snapshot = applyProductivityAction(snapshot, { type: 'reconcile' }, 1_501_000);
    assert.equal(snapshot.pomodoro.state.phase, 'shortBreak');
    // 新契约：番茄数由 **todo-store** 记（宿主在检测到跨周期时调用 recordTodoFocus）；
    // 番茄钟快照里的遗留 todos 不再被改动，否则两处都会计数、且真相分裂。
    assert.equal(snapshot.todos[0].completedPomodoros, 0, '快照里的遗留待办不该被改动');
    assert.equal(snapshot.pomodoro.state.completedFocusCycles, 1, '周期数照常累加');
  });

  it('跳过的专注不记周期；删除关联任务会清掉引用', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(
      snapshot,
      { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests' } },
      0,
    );
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);
    snapshot = applyProductivityAction(snapshot, { type: 'skip' }, 2_000);
    assert.equal(snapshot.pomodoro.state.completedFocusCycles, 0);

    snapshot = applyProductivityAction(snapshot, { type: 'selectTodo', todoId: 'task-1' }, 3_000);
    snapshot = applyProductivityAction(snapshot, { type: 'todo.delete', todoId: 'task-1' }, 4_000);
    assert.equal(snapshot.todos.length, 0);
    assert.equal(snapshot.pomodoro.state.todoId, null);
  });

  it('todoId 只是引用：指向待办存储里不存在的 id 也允许（不再交叉校验）', () => {
    let snapshot = createProductivitySnapshot();
    // 待办的真相在 todos.json，快照里的 todos 是空的——这是解耦后的常态
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'from-todo-store' }, 1_000);
    assert.equal(snapshot.pomodoro.state.todoId, 'from-todo-store');
    snapshot = applyProductivityAction(snapshot, { type: 'selectTodo', todoId: 'another-id' }, 2_000);
    assert.equal(snapshot.pomodoro.state.todoId, 'another-id');
    // 类型仍然要校验：空串/null 之外的怪值照样拒绝
    assert.throws(() => applyProductivityAction(snapshot, { type: 'selectTodo', todoId: '' }, 30), /Todo id/i);
  });

  it('支持遗留 todo 编辑动作与番茄钟设置校验', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(
      snapshot,
      { type: 'todo.create', todo: { id: 'task-1', title: 'Draft', estimatedPomodoros: 2 } },
      10,
    );
    snapshot = applyProductivityAction(
      snapshot,
      { type: 'todo.update', todoId: 'task-1', patch: { title: 'Review', notes: 'Final pass' } },
      20,
    );
    assert.equal(snapshot.todos[0].title, 'Review');
    assert.equal(snapshot.todos[0].notes, 'Final pass');

    snapshot = applyProductivityAction(
      snapshot,
      { type: 'settings.update', settings: { ...snapshot.pomodoro.settings, focusMinutes: 30 } },
      30,
    );
    assert.equal(snapshot.pomodoro.settings.focusMinutes, 30);
    assert.throws(
      () =>
        applyProductivityAction(
          snapshot,
          { type: 'settings.update', settings: { ...snapshot.pomodoro.settings, focusMinutes: 0 } },
          50,
        ),
      /settings/i,
    );
  });

  it('气泡优先用宿主塞进来的 linkedTodo（解耦后标题来自待办存储）', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 't-from-store' }, 1_000);
    // 快照里没有这条待办（它住在 todos.json）——但宿主把标题一起给了
    const view = {
      ...snapshot,
      linkedTodo: { id: 't-from-store', title: '来自待办存储', completedPomodoros: 2, estimatedPomodoros: 5 },
    };
    assert.equal(productivityBubbleText(view, 61_000), '专注中 24:00 · 来自待办存储 2/5');
    // 没有 linkedTodo 时退回遗留表（老快照/老客户端仍能显示标题）
    assert.equal(productivityBubbleText(snapshot, 61_000), '专注中 24:00');
  });
});
