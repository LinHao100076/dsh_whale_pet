
//#region src/shared/pomodoro.ts
const DEFAULT_POMODORO_SETTINGS = {
	focusMinutes: 25,
	shortBreakMinutes: 5,
	longBreakMinutes: 15,
	longBreakEvery: 4,
	showBubble: true,
	notifications: true
};
function durationSeconds(phase, settings = DEFAULT_POMODORO_SETTINGS) {
	const minutes = phase === "focus" ? settings.focusMinutes : phase === "shortBreak" ? settings.shortBreakMinutes : settings.longBreakMinutes;
	return minutes * 60;
}
function createPomodoroState() {
	return {
		phase: "focus",
		remainingSeconds: durationSeconds("focus"),
		running: false,
		endsAt: null,
		todoId: null,
		completedFocusCycles: 0,
		sequence: 0
	};
}
function remaining(state, now) {
	return state.running && state.endsAt !== null ? Math.max(0, Math.ceil((state.endsAt - now) / 1e3)) : state.remainingSeconds;
}
function startTimer(state, todoId, now, settings = DEFAULT_POMODORO_SETTINGS) {
	if (state.running) return state;
	const seconds = state.remainingSeconds > 0 ? state.remainingSeconds : durationSeconds(state.phase, settings);
	return {
		...state,
		todoId,
		remainingSeconds: seconds,
		running: true,
		endsAt: now + seconds * 1e3,
		sequence: state.sequence + 1
	};
}
function pauseTimer(state, now) {
	if (!state.running) return state;
	return {
		...state,
		remainingSeconds: remaining(state, now),
		running: false,
		endsAt: null,
		sequence: state.sequence + 1
	};
}
function resumeTimer(state, now) {
	return startTimer(state, state.todoId, now);
}
function nextPhase(state, settings) {
	const completedFocusTodoId = state.phase === "focus" ? state.todoId : null;
	const completedFocusCycles = state.completedFocusCycles + (state.phase === "focus" ? 1 : 0);
	const phase = state.phase === "focus" ? completedFocusCycles % settings.longBreakEvery === 0 ? "longBreak" : "shortBreak" : "focus";
	return {
		state: {
			...state,
			phase,
			remainingSeconds: durationSeconds(phase, settings),
			running: false,
			endsAt: null,
			todoId: phase === "focus" ? state.todoId : null,
			completedFocusCycles,
			sequence: state.sequence + 1
		},
		completedFocusTodoId
	};
}
function advanceTimer(state, now, settings = DEFAULT_POMODORO_SETTINGS) {
	if (!state.running || state.endsAt === null || state.endsAt > now) return {
		state,
		completedFocusTodoId: null
	};
	return nextPhase(state, settings);
}
function skipTimer(state, _now, settings = DEFAULT_POMODORO_SETTINGS) {
	const transition = nextPhase(state, settings);
	return {
		state: {
			...transition.state,
			completedFocusCycles: state.completedFocusCycles
		},
		completedFocusTodoId: null
	};
}
function resetTimer(state, settings = DEFAULT_POMODORO_SETTINGS) {
	return {
		...state,
		phase: "focus",
		remainingSeconds: durationSeconds("focus", settings),
		running: false,
		endsAt: null,
		todoId: null,
		sequence: state.sequence + 1
	};
}

//#endregion
export { DEFAULT_POMODORO_SETTINGS, advanceTimer, createPomodoroState, pauseTimer, resetTimer, resumeTimer, skipTimer, startTimer };