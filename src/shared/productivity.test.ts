import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyProductivityAction, createProductivitySnapshot, productivityBubbleText } from './productivity';

describe('productivity actions', () => {
  it('formats the active phase, remaining time, and linked Todo for the pet bubble', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests', estimatedPomodoros: 3 } }, 0);
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);
    assert.equal(productivityBubbleText(snapshot, 61_000), '专注中 24:00 · Write tests 0/3');

    const hidden = { ...snapshot, pomodoro: { ...snapshot.pomodoro, settings: { ...snapshot.pomodoro.settings, showBubble: false } } };
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

  it('credits a linked Todo once when a focus timer expires', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests' } }, 0);
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);

    snapshot = applyProductivityAction(snapshot, { type: 'reconcile' }, 1_501_000);
    assert.equal(snapshot.pomodoro.state.phase, 'shortBreak');
    assert.equal(snapshot.todos[0].completedPomodoros, 1);

    snapshot = applyProductivityAction(snapshot, { type: 'reconcile' }, 1_502_000);
    assert.equal(snapshot.todos[0].completedPomodoros, 1);
  });

  it('does not credit a skipped focus and clears a deleted linked Todo', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'todo.create', todo: { id: 'task-1', title: 'Write tests' } }, 0);
    snapshot = applyProductivityAction(snapshot, { type: 'start', todoId: 'task-1' }, 1_000);
    snapshot = applyProductivityAction(snapshot, { type: 'skip' }, 2_000);
    assert.equal(snapshot.todos[0].completedPomodoros, 0);

    snapshot = applyProductivityAction(snapshot, { type: 'selectTodo', todoId: 'task-1' }, 3_000);
    snapshot = applyProductivityAction(snapshot, { type: 'todo.delete', todoId: 'task-1' }, 4_000);
    assert.equal(snapshot.todos.length, 0);
    assert.equal(snapshot.pomodoro.state.todoId, null);
  });

  it('supports Todo edits and validates task selection and timer settings', () => {
    let snapshot = createProductivitySnapshot();
    snapshot = applyProductivityAction(snapshot, { type: 'todo.create', todo: { id: 'task-1', title: 'Draft', estimatedPomodoros: 2 } }, 10);
    snapshot = applyProductivityAction(snapshot, { type: 'todo.update', todoId: 'task-1', patch: { title: 'Review', notes: 'Final pass' } }, 20);
    assert.equal(snapshot.todos[0].title, 'Review');
    assert.equal(snapshot.todos[0].notes, 'Final pass');

    snapshot = applyProductivityAction(snapshot, { type: 'settings.update', settings: { ...snapshot.pomodoro.settings, focusMinutes: 30 } }, 30);
    assert.equal(snapshot.pomodoro.settings.focusMinutes, 30);
    assert.throws(
      () => applyProductivityAction(snapshot, { type: 'selectTodo', todoId: 'missing' }, 40),
      /todo/i,
    );
    assert.throws(
      () => applyProductivityAction(snapshot, { type: 'settings.update', settings: { ...snapshot.pomodoro.settings, focusMinutes: 0 } }, 50),
      /settings/i,
    );
  });
});
