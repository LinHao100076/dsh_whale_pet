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
export function isDateKeyValue(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/** 把任意值归一成合法的日期键（非法/缺失 → null）——存储与路由的入口守卫 */
export function normalizeDateKey(value: unknown): DateKey | null {
  if (value === null || value === undefined || value === '') return null;
  return isDateKeyValue(value) ? value : null;
}

/** 补齐老数据缺失的字段（迁移与读取都走它，保证模型层拿到的对象字段齐全） */
export function normalizeTodoItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<TodoItem>;
  if (typeof t.id !== 'string' || !t.id.trim()) return null;
  if (typeof t.title !== 'string' || !t.title.trim()) return null;
  if (typeof t.notes !== 'string') return null;
  if (typeof t.completed !== 'boolean') return null;
  const int = (v: unknown, fallback: number): number =>
    Number.isInteger(v) && (v as number) >= 0 ? (v as number) : fallback;
  const num = (v: unknown, fallback: number): number => (Number.isFinite(v) ? (v as number) : fallback);
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    completed: t.completed,
    estimatedPomodoros: int(t.estimatedPomodoros, 1),
    completedPomodoros: int(t.completedPomodoros, 0),
    order: num(t.order, 0),
    createdAt: num(t.createdAt, 0),
    updatedAt: num(t.updatedAt, 0),
    dueDate: normalizeDateKey(t.dueDate),
    scheduledDate: normalizeDateKey(t.scheduledDate),
    completedAt: Number.isFinite(t.completedAt) ? (t.completedAt as number) : null,
  };
}

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new TypeError('Todo title must not be blank');
  return normalized;
}

function validateEstimate(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('Todo estimate must be a nonnegative integer');
  return value;
}

/** 日期参数校验：允许 null/undefined（= 不设），给了就必须是合法日期键 */
function validateOptionalDate(value: unknown, field: string): DateKey | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isDateKeyValue(value)) throw new TypeError(`Todo ${field} must be a YYYY-MM-DD date`);
  return value;
}

export function createTodo(items: TodoItem[], input: NewTodo, now: number): TodoItem[] {
  const id = input.id?.trim() || globalThis.crypto.randomUUID();
  if (items.some((item) => item.id === id)) throw new Error(`Todo id already exists: ${id}`);
  const item: TodoItem = {
    id,
    title: validateTitle(input.title),
    notes: input.notes?.trim() ?? '',
    completed: false,
    estimatedPomodoros: validateEstimate(input.estimatedPomodoros ?? 1),
    completedPomodoros: 0,
    order: items.reduce((max, current) => Math.max(max, current.order), -1) + 1,
    createdAt: now,
    updatedAt: now,
    dueDate: validateOptionalDate(input.dueDate, 'dueDate'),
    scheduledDate: validateOptionalDate(input.scheduledDate, 'scheduledDate'),
    completedAt: null,
  };
  return [...items, item];
}

export function updateTodo(items: TodoItem[], id: string, patch: TodoPatch, now: number): TodoItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const updated = { ...item, updatedAt: now };
    if (patch.title !== undefined) updated.title = validateTitle(patch.title);
    if (patch.notes !== undefined) updated.notes = patch.notes.trim();
    if (patch.estimatedPomodoros !== undefined) updated.estimatedPomodoros = validateEstimate(patch.estimatedPomodoros);
    return updated;
  });
}

/** 完成/取消完成：完成时记 completedAt（日历的"已完成"统计与圆点用它），取消时清掉 */
export function setTodoCompleted(items: TodoItem[], id: string, completed: boolean, now: number): TodoItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, completed, completedAt: completed ? now : null, updatedAt: now } : item,
  );
}

/** 改期（拖拽到某个日期 / 清空某个日期）：只动给定的字段，另一个保持原样 */
export function rescheduleTodo(items: TodoItem[], id: string, patch: TodoSchedulePatch, now: number): TodoItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const next: TodoItem = { ...item, updatedAt: now };
    if ('dueDate' in patch) next.dueDate = validateOptionalDate(patch.dueDate, 'dueDate');
    if ('scheduledDate' in patch) next.scheduledDate = validateOptionalDate(patch.scheduledDate, 'scheduledDate');
    return next;
  });
}

export function deleteTodo(items: TodoItem[], id: string): TodoItem[] {
  return items.filter((item) => item.id !== id);
}

export function reorderTodos(items: TodoItem[], orderedIds: string[], now: number): TodoItem[] {
  const ids = new Set(orderedIds);
  if (ids.size !== orderedIds.length || ids.size !== items.length || items.some((item) => !ids.has(item.id))) {
    throw new Error('Todo reorder ids must contain each task exactly once');
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return orderedIds.map((id, order) => ({ ...byId.get(id)!, order, updatedAt: now }));
}

export function recordCompletedFocus(items: TodoItem[], id: string | null, now: number): TodoItem[] {
  if (id === null) return items;
  return items.map((item) =>
    item.id === id ? { ...item, completedPomodoros: item.completedPomodoros + 1, updatedAt: now } : item,
  );
}
