import { type PomodoroSettings, type PomodoroState } from './pomodoro';
import { type NewTodo, type TodoItem, type TodoPatch } from './todo';
export interface ProductivitySnapshot {
    version: 1;
    todos: TodoItem[];
    pomodoro: {
        settings: PomodoroSettings;
        state: PomodoroState;
    };
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
export declare function productivityBubbleText(snapshot: ProductivitySnapshot, now: number): string | null;
export declare function applyProductivityAction(snapshot: ProductivitySnapshot, action: ProductivityAction, now: number): ProductivitySnapshot;
