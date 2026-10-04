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
export declare const DEFAULT_POMODORO_SETTINGS: PomodoroSettings;
export declare function durationSeconds(phase: PomodoroPhase, settings?: PomodoroSettings): number;
export declare function createPomodoroState(): PomodoroState;
export declare function startTimer(state: PomodoroState, todoId: string | null, now: number, settings?: PomodoroSettings): PomodoroState;
export declare function pauseTimer(state: PomodoroState, now: number): PomodoroState;
export declare function resumeTimer(state: PomodoroState, now: number): PomodoroState;
export declare function advanceTimer(state: PomodoroState, now: number, settings?: PomodoroSettings): PomodoroTransition;
export declare function skipTimer(state: PomodoroState, _now: number, settings?: PomodoroSettings): PomodoroTransition;
export declare function resetTimer(state: PomodoroState, settings?: PomodoroSettings): PomodoroState;
export declare function recoverTimer(state: PomodoroState, now: number, settings?: PomodoroSettings): PomodoroTransition;
