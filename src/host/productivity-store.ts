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
    settings.longBreakEvery < 1 || settings.longBreakEvery > 12 ||
    typeof settings.showBubble !== 'boolean' || typeof settings.notifications !== 'boolean'
  )
    throw new Error('Invalid pomodoro settings');
  if (
    !state ||
    !['focus', 'shortBreak', 'longBreak'].includes(state.phase) ||
    typeof state.running !== 'boolean' ||
    !Number.isFinite(state.remainingSeconds) || state.remainingSeconds < 0 ||
    (state.endsAt !== null && !Number.isFinite(state.endsAt)) ||
    (state.running && state.endsAt === null) ||
    (!state.running && state.endsAt !== null) ||
    (state.todoId !== null && typeof state.todoId !== 'string') ||
    !Number.isInteger(state.completedFocusCycles) || state.completedFocusCycles < 0 ||
    !Number.isInteger(state.sequence) || state.sequence < 0
  )
    throw new Error('Invalid pomodoro state');
  const todoIds = new Set<string>();
  for (const todo of v.todos) {
    if (
      !todo || typeof todo.id !== 'string' || !todo.id || todoIds.has(todo.id) ||
      typeof todo.title !== 'string' || !todo.title.trim() || typeof todo.notes !== 'string' ||
      typeof todo.completed !== 'boolean' || !Number.isInteger(todo.estimatedPomodoros) || todo.estimatedPomodoros < 0 ||
      !Number.isInteger(todo.completedPomodoros) || todo.completedPomodoros < 0 ||
      !Number.isFinite(todo.order) || !Number.isFinite(todo.createdAt) || !Number.isFinite(todo.updatedAt)
    ) throw new Error('Invalid Todo item');
    todoIds.add(todo.id);
  }
  if (state.todoId !== null && !todoIds.has(state.todoId)) throw new Error('Invalid selected Todo');
  return value as ProductivitySnapshot;
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
  operationQueue = result.then(() => undefined, () => undefined);
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
