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

function validateTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new TypeError('Todo title must not be blank');
  return normalized;
}

function validateEstimate(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('Todo estimate must be a nonnegative integer');
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

export function setTodoCompleted(items: TodoItem[], id: string, completed: boolean, now: number): TodoItem[] {
  return items.map((item) => (item.id === id ? { ...item, completed, updatedAt: now } : item));
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
