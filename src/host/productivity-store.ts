import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyProductivityAction,
  createProductivitySnapshot,
  type ProductivityAction,
  type ProductivitySnapshot,
} from '../shared/productivity';
export type { ProductivitySnapshot } from '../shared/productivity';
export const PRODUCTIVITY_FILE = 'productivity.json';

export function defaultProductivitySnapshot(): ProductivitySnapshot {
  return createProductivitySnapshot();
}

export function validateProductivitySnapshot(value: unknown): ProductivitySnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid productivity snapshot');
  const v = value as Partial<ProductivitySnapshot>;
  if (v.version !== 1 || !Array.isArray(v.todos) || !v.pomodoro || typeof v.pomodoro !== 'object')
    throw new Error('Invalid productivity snapshot schema');
  const settings = (v.pomodoro as ProductivitySnapshot['pomodoro']).settings;
  const state = (v.pomodoro as ProductivitySnapshot['pomodoro']).state;
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
  )
    throw new Error('Invalid pomodoro settings');
  if (
    !state ||
    !['focus', 'shortBreak', 'longBreak'].includes(state.phase) ||
    typeof state.running !== 'boolean' ||
    !Number.isFinite(state.remainingSeconds) ||
    state.remainingSeconds < 0 ||
    (state.endsAt !== null && !Number.isFinite(state.endsAt)) ||
    (state.running && state.endsAt === null) ||
    (!state.running && state.endsAt !== null) ||
    (state.todoId !== null && typeof state.todoId !== 'string') ||
    !Number.isInteger(state.completedFocusCycles) ||
    state.completedFocusCycles < 0 ||
    !Number.isInteger(state.sequence) ||
    state.sequence < 0
  )
    throw new Error('Invalid pomodoro state');
  // 关联任务只是个**引用**（指向 todos.json 里的 id）：这里只校验类型，
  // 不再要求它出现在本快照的 todos 里——解耦之后待办的真相在 todo-store，
  // 老的交叉校验会让"从待办日历里选的任务"直接被判定为非法。
  if (v.todos.length > 0) {
    const todoIds = new Set<string>();
    for (const todo of v.todos) {
      if (
        !todo ||
        typeof todo.id !== 'string' ||
        !todo.id ||
        todoIds.has(todo.id) ||
        typeof todo.title !== 'string' ||
        !todo.title.trim() ||
        typeof todo.notes !== 'string' ||
        typeof todo.completed !== 'boolean' ||
        !Number.isInteger(todo.estimatedPomodoros) ||
        todo.estimatedPomodoros < 0 ||
        !Number.isInteger(todo.completedPomodoros) ||
        todo.completedPomodoros < 0 ||
        !Number.isFinite(todo.order) ||
        !Number.isFinite(todo.createdAt) ||
        !Number.isFinite(todo.updatedAt)
      )
        throw new Error('Invalid Todo item');
      todoIds.add(todo.id);
    }
  }
  return value as ProductivitySnapshot;
}

/** 每个专注周期完成后，把「该记给哪条待办」告诉调用方（纯函数，不碰存储） */
export interface FocusCompletion {
  /** 关联任务的 id（当时没关联就是 null） */
  todoId: string | null;
  /** 这一次调用跨过了几个专注周期（长时间挂起后 reconcile 可能一次跨过多个） */
  count: number;
}

/**
 * 比较前后两份快照，得出"这次跨过了几个专注周期、记给谁"。
 *
 * 为什么要从**前**一份快照取 todoId：`pomodoro` 在切换到休息阶段时会把 state.todoId 置空
 * （见 shared/pomodoro.ts 的 advanceTimer），所以完成之后已经读不到关联任务了——那时它已经被清掉。
 */
export function focusCompletions(before: ProductivitySnapshot, after: ProductivitySnapshot): FocusCompletion {
  const count = after.pomodoro.state.completedFocusCycles - before.pomodoro.state.completedFocusCycles;
  if (count <= 0) return { todoId: null, count: 0 };
  return { todoId: before.pomodoro.state.todoId, count };
}

export async function readProductivitySnapshot(root: string): Promise<ProductivitySnapshot> {
  try {
    const raw = await readFile(join(root, PRODUCTIVITY_FILE), 'utf8');
    return validateProductivitySnapshot(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultProductivitySnapshot();
    throw error;
  }
}

export async function writeProductivitySnapshot(root: string, snapshot: ProductivitySnapshot): Promise<void> {
  const valid = validateProductivitySnapshot(snapshot);
  await mkdir(root, { recursive: true });
  const target = join(root, PRODUCTIVITY_FILE);
  const temp = join(root, `.${PRODUCTIVITY_FILE}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    try {
      await import('node:fs/promises').then((fs) => fs.unlink(temp));
    } catch {
      /* best-effort cleanup */
    }
    throw error;
  }
}

let operationQueue: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function reconcileProductivitySnapshot(root: string, now = Date.now()): Promise<ProductivitySnapshot> {
  return serialized(async () => {
    const current = await readProductivitySnapshot(root);
    const next = applyProductivityAction(current, { type: 'reconcile' }, now);
    if (next !== current) await writeProductivitySnapshot(root, next);
    return next;
  });
}

export interface ProductivityMutation {
  before: ProductivitySnapshot;
  after: ProductivitySnapshot;
}

/**
 * 与 `mutateProductivitySnapshot` 同一件事，但把**改之前**的快照也返回。
 * 用途：番茄钟与待办解耦之后，"这个专注周期该记给哪条待办"只能靠前后对比得出
 * （见 focusCompletions 的说明：完成后 state.todoId 已被清空）。
 * 读取放在同一个串行区间里，避免"先在队列外读一次"带来的竞态。
 */
export function mutateProductivitySnapshotWithBefore(
  root: string,
  action: ProductivityAction,
  now = Date.now(),
): Promise<ProductivityMutation> {
  return serialized(async () => {
    const before = await readProductivitySnapshot(root);
    const after = applyProductivityAction(before, action, now);
    if (after !== before) await writeProductivitySnapshot(root, after);
    return { before, after };
  });
}

/** 对账版（窥屏读情报时用）：同样返回前后，好把期间跨过的周期记给待办 */
export function reconcileProductivitySnapshotWithBefore(root: string, now = Date.now()): Promise<ProductivityMutation> {
  return serialized(async () => {
    const before = await readProductivitySnapshot(root);
    const after = applyProductivityAction(before, { type: 'reconcile' }, now);
    if (after !== before) await writeProductivitySnapshot(root, after);
    return { before, after };
  });
}

export function mutateProductivitySnapshot(
  root: string,
  action: ProductivityAction,
  now = Date.now(),
): Promise<ProductivitySnapshot> {
  return serialized(async () => {
    const current = await readProductivitySnapshot(root);
    const next = applyProductivityAction(current, action, now);
    await writeProductivitySnapshot(root, next);
    return next;
  });
}
