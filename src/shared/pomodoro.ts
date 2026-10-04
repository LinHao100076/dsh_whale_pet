export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  showBubble: boolean;
  notifications: boolean;
}

export interface PomodoroState {
  phase: PomodoroPhase;
  remainingSeconds: number;
  running: boolean;
  endsAt: number | null;
  todoId: string | null;
  completedFocusCycles: number;
  sequence: number;
}

export interface PomodoroTransition {
  state: PomodoroState;
  completedFocusTodoId: string | null;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  showBubble: true,
  notifications: true,
};

export function durationSeconds(phase: PomodoroPhase, settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS): number {
  const minutes =
    phase === 'focus'
      ? settings.focusMinutes
      : phase === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * 60;
}

export function createPomodoroState(): PomodoroState {
  return {
    phase: 'focus',
    remainingSeconds: durationSeconds('focus'),
    running: false,
    endsAt: null,
    todoId: null,
    completedFocusCycles: 0,
    sequence: 0,
  };
}

function remaining(state: PomodoroState, now: number): number {
  return state.running && state.endsAt !== null
    ? Math.max(0, Math.ceil((state.endsAt - now) / 1000))
    : state.remainingSeconds;
}

export function startTimer(
  state: PomodoroState,
  todoId: string | null,
  now: number,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): PomodoroState {
  if (state.running) return state;
  const seconds = state.remainingSeconds > 0 ? state.remainingSeconds : durationSeconds(state.phase, settings);
  return {
    ...state,
    todoId,
    remainingSeconds: seconds,
    running: true,
    endsAt: now + seconds * 1000,
    sequence: state.sequence + 1,
  };
}

export function pauseTimer(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state;
  return {
    ...state,
    remainingSeconds: remaining(state, now),
    running: false,
    endsAt: null,
    sequence: state.sequence + 1,
  };
}

export function resumeTimer(state: PomodoroState, now: number): PomodoroState {
  return startTimer(state, state.todoId, now);
}

function nextPhase(state: PomodoroState, settings: PomodoroSettings): PomodoroTransition {
  const completedFocusTodoId = state.phase === 'focus' ? state.todoId : null;
  const completedFocusCycles = state.completedFocusCycles + (state.phase === 'focus' ? 1 : 0);
  const phase: PomodoroPhase =
    state.phase === 'focus'
      ? completedFocusCycles % settings.longBreakEvery === 0
        ? 'longBreak'
        : 'shortBreak'
      : 'focus';
  return {
    state: {
      ...state,
      phase,
      remainingSeconds: durationSeconds(phase, settings),
      running: false,
      endsAt: null,
      todoId: phase === 'focus' ? state.todoId : null,
      completedFocusCycles,
      sequence: state.sequence + 1,
    },
    completedFocusTodoId,
  };
}

export function advanceTimer(
  state: PomodoroState,
  now: number,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): PomodoroTransition {
  if (!state.running || state.endsAt === null || state.endsAt > now) return { state, completedFocusTodoId: null };
  return nextPhase(state, settings);
}

export function skipTimer(
  state: PomodoroState,
  _now: number,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): PomodoroTransition {
  const transition = nextPhase(state, settings);
  return {
    state: { ...transition.state, completedFocusCycles: state.completedFocusCycles },
    completedFocusTodoId: null,
  };
}

export function resetTimer(
  state: PomodoroState,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): PomodoroState {
  return {
    ...state,
    phase: 'focus',
    remainingSeconds: durationSeconds('focus', settings),
    running: false,
    endsAt: null,
    todoId: null,
    sequence: state.sequence + 1,
  };
}

export function recoverTimer(
  state: PomodoroState,
  now: number,
  settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS,
): PomodoroTransition {
  if (!state.running || state.endsAt === null) return { state, completedFocusTodoId: null };
  if (state.endsAt > now)
    return { state: { ...state, remainingSeconds: remaining(state, now) }, completedFocusTodoId: null };
  // Recover the expired phase and any complete break phases. Only the first focus completion is attributed;
  // automatic catch-up never starts a new focus session or creates an ambiguous Todo increment.
  const result = nextPhase(state, settings);
  return { state: result.state, completedFocusTodoId: result.completedFocusTodoId };
}
