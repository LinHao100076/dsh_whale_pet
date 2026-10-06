/**
 * 「待办日历」的独立存储（host 半侧）：`<userRoot>/todos.json`。
 *
 * 为什么要把待办从 productivity.json 里搬出来：那份文件是"番茄钟 + Todo"混在一起的一个快照，
 * 待办改一个标题要整份重写、还被番茄钟的状态机牵着走。独立之后：
 *   - 待办有自己的版本号与文件，番茄钟只保留 state.todoId 这个**引用**；
 *   - 读改写的并发窗口更小（各自串行队列），互不阻塞；
 *   - 老数据一次性迁移（migrateLegacyTodos），迁移后两个文件各自独立演化。
 *
 * 与 productivity-store 同一套工程约定：校验失败抛错（绝不静默写坏）、原子写（临时文件 + rename）、
 * 进程内串行队列（防两端交错读改写）。**唯一的有意差异**：todos 是用户的原始数据，
 * 解析失败时先**备份**成 `todos.corrupt-<时间戳>.json` 再以空清单继续（不把用户永久挡在门外）。
 */
import { type DateKey, type NewTodo, type TodoItem, type TodoPatch, type TodoSchedulePatch } from '../shared/todo';
export declare const TODO_FILE = "todos.json";
export declare const TODO_VERSION = 1;
export interface TodoDocument {
    version: typeof TODO_VERSION;
    todos: TodoItem[];
}
export declare function createTodoDocument(): TodoDocument;
/** 待办上的全部动作（走 /todo/action，与番茄钟的 /productivity/action 同风格） */
export type TodoAction = {
    type: 'create';
    todo: NewTodo;
} | {
    type: 'update';
    id: string;
    patch: TodoPatch;
} | {
    type: 'complete';
    id: string;
    completed: boolean;
} | {
    type: 'delete';
    id: string;
} | {
    type: 'reorder';
    orderedIds: string[];
} | {
    type: 'reschedule';
    id: string;
    patch: TodoSchedulePatch;
}
/** 番茄钟跑完一个专注周期（host 内部调用，不经 HTTP）：给关联任务记一次 */
 | {
    type: 'focus';
    id: string | null;
};
export declare function todoFile(root: string): string;
/**
 * 校验并归一化一份待办文档：逐条过 normalizeTodoItem（补齐老数据缺的日期字段），
 * 任何一条非法 → 抛错（调用方决定是备份重来还是上报）。
 */
export declare function validateTodoDocument(value: unknown): TodoDocument;
/** 纯归约：动作 → 新文档（不碰磁盘，可直接单测） */
export declare function applyTodoAction(doc: TodoDocument, action: TodoAction, now: number): TodoDocument;
export interface ReadTodoResult {
    doc: TodoDocument;
    /** 非空 = 读取时发现文件损坏，已备份到该路径并以空清单继续 */
    recoveredFrom?: string;
}
/** 读待办文件：不存在 → 空文档；损坏 → 备份 + 空文档（绝不静默丢用户数据，也不永久挡住用户） */
export declare function readTodoDocument(root: string, warn?: (message: string) => void): Promise<ReadTodoResult>;
/** 原子写（临时文件 + rename），与 productivity-store 一致 */
export declare function writeTodoDocument(root: string, doc: TodoDocument): Promise<void>;
export interface TodoStoreOptions {
    /** 读文件时用来上报"损坏已备份"等异常（默认静默） */
    warn?: (message: string) => void;
    /** legacy 快照读取器（注入以便单测；默认不迁移） */
    readLegacy?: () => Promise<{
        todos: unknown[];
    } | null>;
}
/** 配置存储行为（宿主启动时注入 legacy 读取器与告警出口；测试也用它） */
export declare function configureTodoStore(options: TodoStoreOptions): void;
/**
 * 一次性迁移 + 读取：todos.json 不存在，而老的 productivity.json 里有 todo →
 * 把它们（补齐日期字段）写进 todos.json。
 * 迁移**只做一次**（之后 todos.json 存在了就直接读它），老文件保持原样不动（可回退、可对照）。
 */
export declare function ensureTodoStore(root: string): Promise<TodoDocument>;
/** 读（不存在则先迁移） */
export declare function loadTodos(root: string): Promise<TodoDocument>;
/** 读 → 归约 → 原子写 → 返回新文档（同样先过迁移，绝不抹掉老待办） */
export declare function mutateTodos(root: string, action: TodoAction, now?: number): Promise<TodoDocument>;
/** 便捷：给关联任务记一次专注（番茄钟跑完一个周期时由 host 调用） */
export declare function recordTodoFocus(root: string, id: string | null, now?: number): Promise<TodoDocument>;
/** 便捷：批量改期（拖拽一次只动一条，但接口留成通用形态） */
export declare function rescheduleTodos(root: string, id: string, patch: TodoSchedulePatch, now?: number): Promise<TodoDocument>;
/** 便捷：某天新建一条（日历上点空白格） */
export declare function createTodoOn(root: string, title: string, date: DateKey, now?: number): Promise<TodoDocument>;
export type { DateKey, TodoItem };
