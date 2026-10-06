/**
 * 待办数据模型与纯操作（src/shared，两端共用）。
 *
 * 本文件原本只服务番茄钟面板里的那份清单；「待办日历」把它独立出来之后，这里同时是
 * 独立存储（todos.json）的模型层。两条约束：
 *
 *   ① **日期字段是可选（`?: ... | null`）**：老数据（productivity.json 里的 todo）没有这些字段，
 *      迁移时统一补 null。接口上保持可选，是为了让"尚未解耦的番茄钟路径"能原样编译，
 *      而不是靠类型断言硬掰——真正的补全发生在 todo-store 的读取/迁移里（normalizeTodoItem）。
 *   ② 所有函数都是纯函数：不改入参、返回新数组，便于单测与两端复用。
 */
/** 日期键：'YYYY-MM-DD'（**本地日期**，不是 UTC 的 toISOString） */
export type DateKey = string;
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
    /** 截止日期（日历上以它打点；null/缺失 = 没有截止） */
    dueDate?: DateKey | null;
    /** 计划日期（"我打算哪天做"；null/缺失 = 未排期 → 进收集箱） */
    scheduledDate?: DateKey | null;
    /** 完成时刻（ms）；未完成 = null。日历的"已完成"圆点与统计用它 */
    completedAt?: number | null;
}
export interface NewTodo {
    id?: string;
    title: string;
    notes?: string;
    estimatedPomodoros?: number;
    dueDate?: DateKey | null;
    scheduledDate?: DateKey | null;
}
export type TodoPatch = Partial<Pick<TodoItem, 'title' | 'notes' | 'estimatedPomodoros'>>;
/** 排期补丁（拖拽到某天 / 清空日期） */
export interface TodoSchedulePatch {
    dueDate?: DateKey | null;
    scheduledDate?: DateKey | null;
}
/** 日期键是否合法：严格 YYYY-MM-DD 且是真实存在的日期（拒绝 2026-02-30） */
export declare function isDateKeyValue(value: unknown): value is DateKey;
/** 把任意值归一成合法的日期键（非法/缺失 → null）——存储与路由的入口守卫 */
export declare function normalizeDateKey(value: unknown): DateKey | null;
/** 补齐老数据缺失的字段（迁移与读取都走它，保证模型层拿到的对象字段齐全） */
export declare function normalizeTodoItem(raw: unknown): TodoItem | null;
export declare function createTodo(items: TodoItem[], input: NewTodo, now: number): TodoItem[];
export declare function updateTodo(items: TodoItem[], id: string, patch: TodoPatch, now: number): TodoItem[];
/** 完成/取消完成：完成时记 completedAt（日历的"已完成"统计与圆点用它），取消时清掉 */
export declare function setTodoCompleted(items: TodoItem[], id: string, completed: boolean, now: number): TodoItem[];
/** 改期（拖拽到某个日期 / 清空某个日期）：只动给定的字段，另一个保持原样 */
export declare function rescheduleTodo(items: TodoItem[], id: string, patch: TodoSchedulePatch, now: number): TodoItem[];
export declare function deleteTodo(items: TodoItem[], id: string): TodoItem[];
export declare function reorderTodos(items: TodoItem[], orderedIds: string[], now: number): TodoItem[];
export declare function recordCompletedFocus(items: TodoItem[], id: string | null, now: number): TodoItem[];
