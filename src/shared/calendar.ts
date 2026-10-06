/**
 * 日历与「待办日历」视角的纯逻辑（src/shared，两端共用）。
 *
 * 参考 Obsidian 的 Note Calendar：月历视图 + 左侧周数列 + 单元格圆点 + 选中日期看当天条目。
 * 本文件只做**与 UI 无关的日期数学与分组**，全部纯函数、可单测；农历/节气/调休的标注由 host 另算
 * （见 src/host/todo-calendar.ts：那边才需要农历库与网络数据，客户端只渲染结果）。
 *
 * 日期语义（务必守住）：
 *   - 日期键一律 'YYYY-MM-DD' 的**本地日期**——绝不用 `toISOString()`（那是 UTC，
 *     东八区晚上 8 点之后会算成"明天"，日历格子会整体错位一天）；
 *   - 构造 Date 一律 `new Date(y, m-1, d)` 本地构造，跨月/跨年靠 Date 自己进位。
 */

import type { DateKey, TodoItem } from './todo';
import { isDateKeyValue } from './todo';

export type { DateKey };

/** 月份键：'YYYY-MM' */
export type MonthKey = string;

/** 一天（月历格子里的一格） */
export interface CalendarDay {
  key: DateKey;
  /** 该月内的日号（1-31）；上一月/下一月的补位日也带自己的日号 */
  day: number;
  /** false = 补位日（不属于当前月），渲染上淡化 */
  inMonth: boolean;
  /** 该行对应的 ISO 周号（1-53） */
  week: number;
  /** 0=周日 … 6=周六（本地） */
  weekday: number;
}

/** 一行（一周） */
export interface CalendarWeek {
  /** 该行 ISO 周号 */
  week: number;
  days: CalendarDay[];
}

/** 月份键是否合法：YYYY-MM 且月份在 1-12 */
export function isMonthKey(value: unknown): value is MonthKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Date → 本地日期键 */
export function dateKeyOf(date: Date): DateKey {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 日期键 → 本地 Date（非法输入抛错：调用方必须先过 isDateKeyValue） */
export function parseDateKey(key: DateKey): Date {
  if (!isDateKeyValue(key)) throw new TypeError(`Invalid date key: ${String(key)}`);
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 今天（本地） */
export function todayKey(now: number = Date.now()): DateKey {
  return dateKeyOf(new Date(now));
}

/** 日期键 ± N 天（跨月/跨年自动进位） */
export function addDays(key: DateKey, days: number): DateKey {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKeyOf(d);
}

/** 日期键所属月份键 */
export function monthKeyOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

/** 月份键 ± N 月 */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  // 用 Date 归一（第 0 月 = 上一年 12 月，第 13 月 = 下一年 1 月）
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 该月第一天 / 最后一天 / 天数 */
export function monthBounds(month: MonthKey): { first: DateKey; last: DateKey; days: number } {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0); // 下月第 0 天 = 本月最后一天
  return { first: dateKeyOf(first), last: dateKeyOf(last), days: last.getDate() };
}

/**
 * ISO 8601 周号（1-53）：用"该周周四"定周——这是 ISO 的定义，也是周数列唯一稳妥的算法
 * （直接按 1 月 1 日算会在跨年周上错，比如 12/31 属于下一年的第 1 周）。
 */
export function isoWeekNumber(key: DateKey): number {
  const date = parseDateKey(key);
  const dayNum = (date.getDay() + 6) % 7; // 周一=0 … 周日=6
  date.setDate(date.getDate() - dayNum + 3); // 挪到本周周四
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/**
 * 生成月历网格（整周对齐）：从该月第一天的所在周开始，到该月最后一天的所在周结束。
 * @param weekStart 0=周日开头 / 1=周一开头（Note Calendar 的"一周起始日"配置项）
 */
export function monthGrid(month: MonthKey, weekStart: 0 | 1 = 1): CalendarWeek[] {
  const { first, last } = monthBounds(month);
  const firstDate = parseDateKey(first);
  const lastDate = parseDateKey(last);
  const leading = (firstDate.getDay() - weekStart + 7) % 7; // 月初前要补几格
  const startKey = addDays(first, -leading);
  const trailing = (weekStart - 1 - lastDate.getDay() + 7) % 7; // 月末后要补几格（对齐到周末）
  const totalDays = (lastDate.getTime() - firstDate.getTime()) / 86400000 + 1 + leading + trailing;

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < totalDays; i += 7) {
    const days: CalendarDay[] = [];
    for (let j = 0; j < 7; j++) {
      const key = addDays(startKey, i + j);
      const date = parseDateKey(key);
      days.push({
        key,
        day: date.getDate(),
        inMonth: monthKeyOf(key) === month,
        week: isoWeekNumber(key),
        weekday: date.getDay(),
      });
    }
    // 一行共用同一个周号：取该行周四所在的 ISO 周（跨年周也能给出正确归属）
    weeks.push({ week: isoWeekNumber(addDays(days[0].key, 3)), days });
  }
  return weeks;
}

/** 月份标题：'2026-10' → '2026 年 10 月' */
export function formatMonthTitle(month: MonthKey): string {
  const [y, m] = month.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

/** 日期标题：'2026-10-05' → '2026 年 10 月 5 日 周一' */
export function formatDateLabel(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number);
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${y} 年 ${m} 月 ${d} 日 ${names[parseDateKey(key).getDay()]}`;
}

// ---------------- 「待办日历」视角 ----------------

/** 日历以哪个日期打点 */
export type TodoDateField = 'due' | 'scheduled';

/** 取一条待办在指定字段上的日期键 */
export function todoDateOf(todo: TodoItem, field: TodoDateField): DateKey | null {
  const value = field === 'due' ? todo.dueDate : todo.scheduledDate;
  return value ?? null;
}

/** 某一天的待办（按 order 稳定排序）；不含已完成？——由调用方决定，这里都给 */
export function todosOnDate(todos: TodoItem[], key: DateKey, field: TodoDateField): TodoItem[] {
  return todos
    .filter((todo) => todoDateOf(todo, field) === key)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** 未排期（收集箱）：计划日期与截止日期都没有 */
export function unscheduledTodos(todos: TodoItem[]): TodoItem[] {
  return todos
    .filter((todo) => !todo.dueDate && !todo.scheduledDate)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/**
 * 逾期：有截止日期、早于今天、且还没完成。
 * 只按**截止日期**算逾期——计划日期过期不是逾期（"我打算昨天做"没做成不算欠债）。
 */
export function overdueTodos(todos: TodoItem[], today: DateKey = todayKey()): TodoItem[] {
  return todos
    .filter((todo) => !todo.completed && todo.dueDate !== null && todo.dueDate !== undefined && todo.dueDate < today)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.order - b.order);
}

/** 单元格圆点：某天有未完成 / 已完成各几件（0 就不显示那个颜色的点） */
export interface TodoDayCount {
  open: number;
  done: number;
}

/** 按月历格子需要的形状统计：日期键 → {open, done}（只含有待办的日期） */
export function todoCountsByDate(todos: TodoItem[], field: TodoDateField): Record<DateKey, TodoDayCount> {
  const out: Record<DateKey, TodoDayCount> = {};
  for (const todo of todos) {
    const key = todoDateOf(todo, field);
    if (!key) continue;
    const slot = (out[key] ??= { open: 0, done: 0 });
    if (todo.completed) slot.done += 1;
    else slot.open += 1;
  }
  return out;
}

/** 汇总：今天要做的 / 逾期的 / 未排期的（面板顶部那三块数字） */
export function todoDigest(
  todos: TodoItem[],
  today: DateKey = todayKey(),
  field: TodoDateField = 'due',
): { todayOpen: number; todayDone: number; overdue: number; unscheduled: number; done: number; total: number } {
  let todayOpen = 0;
  let todayDone = 0;
  let done = 0;
  for (const todo of todos) {
    if (todo.completed) done += 1;
    if (todoDateOf(todo, field) !== today) continue;
    if (todo.completed) todayDone += 1;
    else todayOpen += 1;
  }
  return {
    todayOpen,
    todayDone,
    overdue: overdueTodos(todos, today).length,
    unscheduled: unscheduledTodos(todos).length,
    done,
    total: todos.length,
  };
}
