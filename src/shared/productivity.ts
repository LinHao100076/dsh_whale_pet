import {
  advanceTimer,
  createPomodoroState,
  DEFAULT_POMODORO_SETTINGS,
  durationSeconds,
  pauseTimer,
  resetTimer,
  resumeTimer,
  skipTimer,
  startTimer,
  type PomodoroSettings,
  type PomodoroState,
} from './pomodoro';
import {
  createTodo,
  deleteTodo,
  recordCompletedFocus,
  reorderTodos,
  setTodoCompleted,
  updateTodo,
  type NewTodo,
  type TodoItem,
  type TodoPatch,
} from './todo';

export interface ProductivitySnapshot {
  version: 1;
  todos: TodoItem[];
  pomodoro: { settings: PomodoroSettings; state: PomodoroState };
}

export type ProductivityAction =
  | { type: 'reconcile' }
  | { type: 'start'; todoId?: string | null }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'reset' }
  | { type: 'selectTodo'; todoId: string | null }
  | { type: 'settings.update'; settings: PomodoroSettings }
  | { type: 'todo.create'; todo: NewTodo }
  | { type: 'todo.update'; todoId: string; patch: TodoPatch }
  | { type: 'todo.complete'; todoId: string; completed: boolean }
  | { type: 'todo.delete'; todoId: string }
  | { type: 'todo.reorder'; orderedIds: string[] };

export function createProductivitySnapshot(): ProductivitySnapshot {
  return {
    version: 1,
    todos: [],
    pomodoro: { settings: { ...DEFAULT_POMODORO_SETTINGS }, state: createPomodoroState() },
  };
}

export function productivityBubbleText(snapshot: ProductivitySnapshot, now: number): string | null {
  const { settings, state } = snapshot.pomodoro;
  const configuredDuration = durationSeconds(state.phase, settings);
  if (!settings.showBubble || (!state.running && state.remainingSeconds >= configuredDuration)) return null;
  const seconds = state.running && state.endsAt !== null
    ? Math.max(0, Math.ceil((state.endsAt - now) / 1000))
    : state.remainingSeconds;
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const phase = state.phase === 'focus' ? '专注中' : state.phase === 'shortBreak' ? '短休息' : '长休息';
  const todo = snapshot.todos.find((item) => item.id === state.todoId);
  return `${phase} ${clock}${todo ? ` · ${todo.title} ${todo.completedPomodoros}/${todo.estimatedPomodoros}` : ''}`;
}

function validateSettings(settings: PomodoroSettings): PomodoroSettings {
  if (
    !settings ||
    !Number.isInteger(settings.focusMinutes) || settings.focusMinutes < 1 || settings.focusMinutes > 180 ||
    !Number.isInteger(settings.shortBreakMinutes) || settings.shortBreakMinutes < 1 || settings.shortBreakMinutes > 60 ||
    !Number.isInteger(settings.longBreakMinutes) || settings.longBreakMinutes < 1 || settings.longBreakMinutes > 120 ||
    !Number.isInteger(settings.longBreakEvery) || settings.longBreakEvery < 1 || settings.longBreakEvery > 12 ||
    typeof settings.showBubble !== 'boolean' || typeof settings.notifications !== 'boolean'
  ) {
    throw new RangeError('Invalid Pomodoro settings');
  }
  return { ...settings };
}

function reconcile(snapshot: ProductivitySnapshot, now: number): ProductivitySnapshot {
  const transition = advanceTimer(snapshot.pomodoro.state, now, snapshot.pomodoro.settings);
  if (transition.state === snapshot.pomodoro.state) return snapshot;
  return {
    ...snapshot,
    todos: recordCompletedFocus(snapshot.todos, transition.completedFocusTodoId, now),
    pomodoro: { ...snapshot.pomodoro, state: transition.state },
  };
}

export function applyProductivityAction(
  snapshot: ProductivitySnapshot,
  action: ProductivityAction,
  now: number,
): ProductivitySnapshot {
  const current = reconcile(snapshot, now);
  const { state, settings } = current.pomodoro;

  switch (action.type) {
    case 'reconcile':
      return current;
    case 'start': {
      const todoId = action.todoId === undefined ? state.todoId : action.todoId;
      if (todoId !== null && !current.todos.some((todo) => todo.id === todoId && !todo.completed)) {
        throw new Error('Selected Todo does not exist or is already complete');
      }
      return {
        ...current,
        pomodoro: { ...current.pomodoro, state: startTimer(state, state.phase === 'focus' ? todoId : null, now, settings) },
      };
    }
    case 'pause':
      return { ...current, pomodoro: { ...current.pomodoro, state: pauseTimer(state, now) } };
    case 'resume':
      return { ...current, pomodoro: { ...current.pomodoro, state: resumeTimer(state, now) } };
    case 'skip':
      return { ...current, pomodoro: { ...current.pomodoro, state: skipTimer(state, now, settings).state } };
    case 'reset':
      return { ...current, pomodoro: { ...current.pomodoro, state: resetTimer(state, settings) } };
    case 'selectTodo': {
      if (action.todoId !== null && !current.todos.some((todo) => todo.id === action.todoId && !todo.completed)) {
        throw new Error('Selected Todo does not exist or is already complete');
      }
      return {
        ...current,
        pomodoro: { ...current.pomodoro, state: { ...state, todoId: state.phase === 'focus' ? action.todoId : null } },
      };
    }
    case 'settings.update': {
      const nextSettings = validateSettings(action.settings);
      return {
        ...current,
        pomodoro: {
          settings: nextSettings,
          // Changing settings adjusts an idle phase immediately. An active countdown keeps its deadline;
          // new durations take effect when the next phase starts.
          state: state.running
            ? state
            : { ...state, remainingSeconds: durationSeconds(state.phase, nextSettings) },
        },
      };
    }
    case 'todo.create':
      return { ...current, todos: createTodo(current.todos, action.todo, now) };
    case 'todo.update':
      return { ...current, todos: updateTodo(current.todos, action.todoId, action.patch, now) };
    case 'todo.complete': {
      const todos = setTodoCompleted(current.todos, action.todoId, action.completed, now);
      const selected = state.todoId === action.todoId && action.completed ? null : state.todoId;
      return {
        ...current,
        todos,
        pomodoro: { ...current.pomodoro, state: selected === state.todoId ? state : { ...state, todoId: selected } },
      };
    }
    case 'todo.delete': {
      const selected = state.todoId === action.todoId ? null : state.todoId;
      return {
        ...current,
        todos: deleteTodo(current.todos, action.todoId),
        pomodoro: { ...current.pomodoro, state: selected === state.todoId ? state : { ...state, todoId: selected } },
      };
    }
    case 'todo.reorder':
      return { ...current, todos: reorderTodos(current.todos, action.orderedIds, now) };
  }
}
