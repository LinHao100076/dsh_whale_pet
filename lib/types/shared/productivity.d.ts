import { type PomodoroSettings, type PomodoroState } from './pomodoro';
import { type NewTodo, type TodoItem, type TodoPatch } from './todo';
export interface ProductivitySnapshot {
    version: 1;
    /**
     * **遗留字段**：待办已独立到 `todos.json`（见 host/todo-store.ts）。
     * 这张表现在只承担两件事：① 一次性迁移时的数据来源；② 老快照仍能通过校验。
     * 番茄钟面板不再读写它，番茄钟与待办之间只剩 `pomodoro.state.todoId` 这个引用。
     * 保留 todo.* 动作是为了老客户端/老快照兼容，新代码不要再用。
     */
    todos: TodoItem[];
    pomodoro: {
        settings: PomodoroSettings;
        state: PomodoroState;
    };
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
export type ProductivityAction = {
    type: 'reconcile';
} | {
    type: 'start';
    todoId?: string | null;
} | {
    type: 'pause';
} | {
    type: 'resume';
} | {
    type: 'skip';
} | {
    type: 'reset';
} | {
    type: 'selectTodo';
    todoId: string | null;
} | {
    type: 'settings.update';
    settings: PomodoroSettings;
} | {
    type: 'todo.create';
    todo: NewTodo;
} | {
    type: 'todo.update';
    todoId: string;
    patch: TodoPatch;
} | {
    type: 'todo.complete';
    todoId: string;
    completed: boolean;
} | {
    type: 'todo.delete';
    todoId: string;
} | {
    type: 'todo.reorder';
    orderedIds: string[];
};
export declare function createProductivitySnapshot(): ProductivitySnapshot;
export declare function productivityBubbleText(view: ProductivityView, now: number): string | null;
export declare function applyProductivityAction(snapshot: ProductivitySnapshot, action: ProductivityAction, now: number): ProductivitySnapshot;
