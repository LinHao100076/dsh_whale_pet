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

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createTodo,
  deleteTodo,
  normalizeTodoItem,
  recordCompletedFocus,
  reorderTodos,
  rescheduleTodo,
  setTodoCompleted,
  updateTodo,
  type DateKey,
  type NewTodo,
  type TodoItem,
  type TodoPatch,
  type TodoSchedulePatch,
} from '../shared/todo';

export const TODO_FILE = 'todos.json';
export const TODO_VERSION = 1;

export interface TodoDocument {
  version: typeof TODO_VERSION;
  todos: TodoItem[];
}

export function createTodoDocument(): TodoDocument {
  return { version: TODO_VERSION, todos: [] };
}

/** 待办上的全部动作（走 /todo/action，与番茄钟的 /productivity/action 同风格） */
export type TodoAction =
  | { type: 'create'; todo: NewTodo }
  | { type: 'update'; id: string; patch: TodoPatch }
  | { type: 'complete'; id: string; completed: boolean }
  | { type: 'delete'; id: string }
  | { type: 'reorder'; orderedIds: string[] }
  | { type: 'reschedule'; id: string; patch: TodoSchedulePatch }
  /** 番茄钟跑完一个专注周期（host 内部调用，不经 HTTP）：给关联任务记一次 */
  | { type: 'focus'; id: string | null };

export function todoFile(root: string): string {
  return join(root, TODO_FILE);
}

/**
 * 校验并归一化一份待办文档：逐条过 normalizeTodoItem（补齐老数据缺的日期字段），
 * 任何一条非法 → 抛错（调用方决定是备份重来还是上报）。
 */
export function validateTodoDocument(value: unknown): TodoDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid todo document');
  const v = value as Partial<TodoDocument>;
  if (v.version !== TODO_VERSION || !Array.isArray(v.todos)) throw new Error('Invalid todo document schema');
  const todos: TodoItem[] = [];
  const ids = new Set<string>();
  for (const raw of v.todos) {
    const item = normalizeTodoItem(raw);
    if (!item) throw new Error('Invalid Todo item');
    if (ids.has(item.id)) throw new Error(`Duplicate Todo id: ${item.id}`);
    ids.add(item.id);
    todos.push(item);
  }
  return { version: TODO_VERSION, todos };
}

/** 纯归约：动作 → 新文档（不碰磁盘，可直接单测） */
export function applyTodoAction(doc: TodoDocument, action: TodoAction, now: number): TodoDocument {
  switch (action.type) {
    case 'create':
      return { ...doc, todos: createTodo(doc.todos, action.todo, now) };
    case 'update':
      return { ...doc, todos: updateTodo(doc.todos, action.id, action.patch, now) };
    case 'complete':
      return { ...doc, todos: setTodoCompleted(doc.todos, action.id, action.completed, now) };
    case 'delete':
      return { ...doc, todos: deleteTodo(doc.todos, action.id) };
    case 'reorder':
      return { ...doc, todos: reorderTodos(doc.todos, action.orderedIds, now) };
    case 'reschedule':
      return { ...doc, todos: rescheduleTodo(doc.todos, action.id, action.patch, now) };
    case 'focus':
      return { ...doc, todos: recordCompletedFocus(doc.todos, action.id, now) };
    default:
      return doc;
  }
}

export interface ReadTodoResult {
  doc: TodoDocument;
  /** 非空 = 读取时发现文件损坏，已备份到该路径并以空清单继续 */
  recoveredFrom?: string;
}

/** 读待办文件：不存在 → 空文档；损坏 → 备份 + 空文档（绝不静默丢用户数据，也不永久挡住用户） */
export async function readTodoDocument(root: string, warn?: (message: string) => void): Promise<ReadTodoResult> {
  const file = todoFile(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { doc: createTodoDocument() };
    throw error;
  }
  try {
    return { doc: validateTodoDocument(JSON.parse(raw)) };
  } catch (error) {
    const backup = join(root, `todos.corrupt-${Date.now()}.json`);
    try {
      await writeFile(backup, raw, 'utf8');
      await unlink(file);
    } catch {
      /* 备份失败也要继续：至少让用户能打开面板 */
    }
    warn?.(
      `待办文件解析失败（${error instanceof Error ? error.message : String(error)}），` +
        `已备份为 ${backup} 并以空清单继续`,
    );
    return { doc: createTodoDocument(), recoveredFrom: backup };
  }
}

/** 原子写（临时文件 + rename），与 productivity-store 一致 */
export async function writeTodoDocument(root: string, doc: TodoDocument): Promise<void> {
  const valid = validateTodoDocument(doc);
  await mkdir(root, { recursive: true });
  const target = todoFile(root);
  const temp = join(root, `.${TODO_FILE}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    try {
      await unlink(temp);
    } catch {
      /* best-effort */
    }
    throw error;
  }
}

/** 进程内串行队列：两端同时操作也不会交错读改写（各自文件各自的队列） */
let queue: Promise<void> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export interface TodoStoreOptions {
  /** 读文件时用来上报"损坏已备份"等异常（默认静默） */
  warn?: (message: string) => void;
  /** legacy 快照读取器（注入以便单测；默认不迁移） */
  readLegacy?: () => Promise<{ todos: unknown[] } | null>;
}

let storeOptions: TodoStoreOptions = {};

/** 配置存储行为（宿主启动时注入 legacy 读取器与告警出口；测试也用它） */
export function configureTodoStore(options: TodoStoreOptions): void {
  storeOptions = options;
}

/**
 * 读取的**唯一**内核（不含串行包装）：文件不存在就尝试一次性从老快照迁移。
 *
 * 为什么三条入口（load / mutate / ensure）都必须走它：迁移是"第一次读"的副作用。
 * 如果 `mutateTodos` 直接读文件，用户升级后第一次操作若是"新建一条"，
 * 它会读到空文档 → 写盘 → **老待办原地蒸发**。所以任何读写之前都必须先过这里。
 *
 * 这里**不能**再包一层 serialized（会与外层队列互相等待 → 死锁）：串行包装只在公开入口上。
 */
async function loadFresh(root: string): Promise<TodoDocument> {
  // 判"文件在不在"，而不是"里面有没有东西"：用户把待办全删光之后，
  // todos.json 是一份**合法的空清单**，绝不能再从老快照里把已删的条目复活一遍。
  const exists = await readFile(todoFile(root), 'utf8').then(
    () => true,
    () => false,
  );
  const existing = await readTodoDocument(root, storeOptions.warn);
  if (exists || !storeOptions.readLegacy) return existing.doc;
  try {
    const legacy = await storeOptions.readLegacy();
    const migrated = (legacy?.todos ?? []).map((raw) => normalizeTodoItem(raw)).filter((t): t is TodoItem => !!t);
    if (migrated.length === 0) return existing.doc;
    const doc: TodoDocument = { version: TODO_VERSION, todos: migrated };
    await writeTodoDocument(root, doc);
    storeOptions.warn?.(`已从 productivity.json 迁移 ${migrated.length} 条待办到 ${TODO_FILE}`);
    return doc;
  } catch (error) {
    storeOptions.warn?.(
      `待办迁移失败（忽略，继续用空清单）：${error instanceof Error ? error.message : String(error)}`,
    );
    return existing.doc;
  }
}

/**
 * 一次性迁移 + 读取：todos.json 不存在，而老的 productivity.json 里有 todo →
 * 把它们（补齐日期字段）写进 todos.json。
 * 迁移**只做一次**（之后 todos.json 存在了就直接读它），老文件保持原样不动（可回退、可对照）。
 */
export function ensureTodoStore(root: string): Promise<TodoDocument> {
  return serialized(() => loadFresh(root));
}

/** 读（不存在则先迁移） */
export function loadTodos(root: string): Promise<TodoDocument> {
  return serialized(() => loadFresh(root));
}

/** 读 → 归约 → 原子写 → 返回新文档（同样先过迁移，绝不抹掉老待办） */
export function mutateTodos(root: string, action: TodoAction, now = Date.now()): Promise<TodoDocument> {
  return serialized(async () => {
    const doc = await loadFresh(root);
    const next = applyTodoAction(doc, action, now);
    await writeTodoDocument(root, next);
    return next;
  });
}

/** 便捷：给关联任务记一次专注（番茄钟跑完一个周期时由 host 调用） */
export function recordTodoFocus(root: string, id: string | null, now = Date.now()): Promise<TodoDocument> {
  return mutateTodos(root, { type: 'focus', id }, now);
}

/** 便捷：批量改期（拖拽一次只动一条，但接口留成通用形态） */
export function rescheduleTodos(root: string, id: string, patch: TodoSchedulePatch, now = Date.now()) {
  return mutateTodos(root, { type: 'reschedule', id, patch }, now);
}

/** 便捷：某天新建一条（日历上点空白格） */
export function createTodoOn(root: string, title: string, date: DateKey, now = Date.now()) {
  return mutateTodos(root, { type: 'create', todo: { title, dueDate: date } }, now);
}

export type { DateKey, TodoItem };
