import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_POMODORO_SETTINGS,
  createPomodoroState,
  startTimer,
  pauseTimer,
  resumeTimer,
  advanceTimer,
  skipTimer,
  resetTimer,
  recoverTimer,
} from './pomodoro';

describe('Pomodoro state machine', () => {
  it('uses the familiar defaults and starts a focus phase at an absolute deadline', () => {
    assert.deepEqual(DEFAULT_POMODORO_SETTINGS, {
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      showBubble: true,
      notifications: true,
    });
    const state = startTimer(createPomodoroState(), 'todo-1', 1_000);
    assert.equal(state.running, true);
    assert.equal(state.todoId, 'todo-1');
    assert.equal(state.endsAt, 1_501_000);
  });

  it('pauses and resumes without losing time', () => {
    const running = startTimer(createPomodoroState(), null, 1_000);
    const paused = pauseTimer(running, 61_000);
    assert.equal(paused.remainingSeconds, 1440);
    assert.equal(paused.endsAt, null);
    const resumed = resumeTimer(paused, 100_000);
    assert.equal(resumed.endsAt, 1_540_000);
  });

  it('counts naturally completed focus once and schedules short then long breaks', () => {
    let s = createPomodoroState();
    for (let i = 1; i <= 4; i++) {
      s = startTimer(s, 'todo-1', i * 2_000_000);
      const result = advanceTimer(s, s.endsAt!);
      assert.equal(result.completedFocusTodoId, 'todo-1');
      s = result.state;
      assert.equal(s.completedFocusCycles, i);
      assert.equal(s.phase, i === 4 ? 'longBreak' : 'shortBreak');
      assert.equal(s.running, false);
      if (i < 4) {
        s = advanceTimer(startTimer(s, null, i * 2_000_000 + 1), i * 2_000_000 + 301_000).state;
      }
    }
    assert.equal(advanceTimer(s, 99_000_000).completedFocusTodoId, null);
  });

  it('does not count a skipped focus, and reset restores a clean focus state', () => {
    const running = startTimer(createPomodoroState(), 'todo-1', 100);
    const skipped = skipTimer(running, 200);
    assert.equal(skipped.state.completedFocusCycles, 0);
    assert.equal(skipped.completedFocusTodoId, null);
    assert.equal(resetTimer(skipped.state).phase, 'focus');
  });

  it('recovers a running phase after restart, including elapsed phases', () => {
    const running = startTimer(createPomodoroState(), null, 0);
    assert.equal(recoverTimer(running, 60_000).state.remainingSeconds, 1440);
    const elapsed = recoverTimer(running, 1_501_000);
    assert.equal(elapsed.state.phase, 'shortBreak');
    assert.equal(elapsed.state.running, false);
    assert.equal(elapsed.completedFocusTodoId, null);
  });
});
