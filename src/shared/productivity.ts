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
  reorderTodos,
  setTodoCompleted,
  updateTodo,
  type NewTodo,
  type TodoItem,
  type TodoPatch,
} from './todo';

export interface ProductivitySnapshot {
  version: 1;
  /**
   * **遗留字段**：待办已独立到 `todos.json`（见 host/todo-store.ts）。
   * 这张表现在只承担两件事：① 一次性迁移时的数据来源；② 老快照仍能通过校验。
   * 番茄钟面板不再读写它，番茄钟与待办之间只剩 `pomodoro.state.todoId` 这个引用。
   * 保留 todo.* 动作是为了老客户端/老快照兼容，新代码不要再用。
   */
  todos: TodoItem[];
  pomodoro: { settings: PomodoroSettings; state: PomodoroState };
}

/** 关联任务的展示信息（由宿主从 todo-store 查好后塞进 /productivity 响应里，客户端零额外请求） */
export interface LinkedTodo {
  id: string;
  title: string;
  completedPomodoros: number;
  estimatedPomodoros: number;
}

/** 客户端实际拿到的形状：快照 + 宿主补的关联任务（旧客户端不认这个字段，忽略即可） */
export interface ProductivityView extends ProductivitySnapshot {
  linkedTodo?: LinkedTodo | null;
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

export function productivityBubbleText(view: ProductivityView, now: number): string | null {
  const { settings, state } = view.pomodoro;
  const configuredDuration = durationSeconds(state.phase, settings);
  if (!settings.showBubble || (!state.running && state.remainingSeconds >= configuredDuration)) return null;
  const seconds =
    state.running && state.endsAt !== null
      ? Math.max(0, Math.ceil((state.endsAt - now) / 1000))
      : state.remainingSeconds;
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const phase = state.phase === 'focus' ? '专注中' : state.phase === 'shortBreak' ? '短休息' : '长休息';
  // 关联任务标题：优先用宿主塞进来的 linkedTodo（待办已独立存储）；
  // 没有就退回遗留的 todos 表（老快照/老客户端仍然能显示标题）。
  const linked =
    view.linkedTodo ??
    (state.todoId ? (view.todos.find((item) => item.id === state.todoId) as LinkedTodo | undefined) : undefined);
  return `${phase} ${clock}${linked ? ` · ${linked.title} ${linked.completedPomodoros}/${linked.estimatedPomodoros}` : ''}`;
}

function validateSettings(settings: PomodoroSettings): PomodoroSettings {
  if (
    !settings ||
    !Number.isInteger(settings.focusMinutes) ||
    settings.focusMinutes < 1 ||
    settings.focusMinutes > 180 ||
    !Number.isInteger(settings.shortBreakMinutes) ||
    settings.shortBreakMinutes < 1 ||
    settings.shortBreakMinutes > 60 ||
    !Number.isInteger(settings.longBreakMinutes) ||
    settings.longBreakMinutes < 1 ||
    settings.longBreakMinutes > 120 ||
    !Number.isInteger(settings.longBreakEvery) ||
    settings.longBreakEvery < 1 ||
    settings.longBreakEvery > 12 ||
    typeof settings.showBubble !== 'boolean' ||
    typeof settings.notifications !== 'boolean'
  ) {
    throw new RangeError('Invalid Pomodoro settings');
  }
  return { ...settings };
}

function reconcile(snapshot: ProductivitySnapshot, now: number): ProductivitySnapshot {
  const transition = advanceTimer(snapshot.pomodoro.state, now, snapshot.pomodoro.settings);
  if (transition.state === snapshot.pomodoro.state) return snapshot;
  // 「待办」已经独立成自己的存储（todos.json）：
  // 这里**不再**给 snapshot.todos 里的任务累加番茄数——那是 todo-store 的事，
  // 由宿主在检测到"跨过了一个专注周期"时调用 recordTodoFocus 记一次（见 host/index.ts）。
  // 番茄钟这边只保留 state.todoId 这个**引用**（它指向 todos.json 里的 id）。
  return { ...snapshot, pomodoro: { ...snapshot.pomodoro, state: transition.state } };
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
      // todoId 只是个**引用**（指向 todos.json）——不再校验它是否存在于 snapshot.todos：
      // 解耦之后那张表只用于一次性迁移，待办的真相在 todo-store 里。
      const todoId = action.todoId === undefined ? state.todoId : action.todoId;
      if (todoId !== null && (typeof todoId !== 'string' || !todoId)) {
        throw new Error('Selected Todo id must be a non-empty string or null');
      }
      return {
        ...current,
        pomodoro: {
          ...current.pomodoro,
          state: startTimer(state, state.phase === 'focus' ? todoId : null, now, settings),
        },
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
      // 同上：只做类型校验，不查 snapshot.todos（真相在 todo-store）
      if (action.todoId !== null && (typeof action.todoId !== 'string' || !action.todoId)) {
        throw new Error('Selected Todo id must be a non-empty string or null');
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
          state: state.running ? state : { ...state, remainingSeconds: durationSeconds(state.phase, nextSettings) },
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
