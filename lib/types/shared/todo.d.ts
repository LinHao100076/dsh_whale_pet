export interface TodoItem {
    id: string;
    title: string;
    notes: string;
    completed: boolean;
    estimatedPomodoros: number;
    completedPomodoros: number;
    order: number;
    createdAt: number;
    updatedAt: number;
}
export interface NewTodo {
    id?: string;
    title: string;
    notes?: string;
    estimatedPomodoros?: number;
}
export type TodoPatch = Partial<Pick<TodoItem, 'title' | 'notes' | 'estimatedPomodoros'>>;
export declare function createTodo(items: TodoItem[], input: NewTodo, now: number): TodoItem[];
export declare function updateTodo(items: TodoItem[], id: string, patch: TodoPatch, now: number): TodoItem[];
export declare function setTodoCompleted(items: TodoItem[], id: string, completed: boolean, now: number): TodoItem[];
export declare function deleteTodo(items: TodoItem[], id: string): TodoItem[];
export declare function reorderTodos(items: TodoItem[], orderedIds: string[], now: number): TodoItem[];
export declare function recordCompletedFocus(items: TodoItem[], id: string | null, now: number): TodoItem[];
