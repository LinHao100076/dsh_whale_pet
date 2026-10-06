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
export declare function isMonthKey(value: unknown): value is MonthKey;
/** Date → 本地日期键 */
export declare function dateKeyOf(date: Date): DateKey;
/** 日期键 → 本地 Date（非法输入抛错：调用方必须先过 isDateKeyValue） */
export declare function parseDateKey(key: DateKey): Date;
/** 今天（本地） */
export declare function todayKey(now?: number): DateKey;
/** 日期键 ± N 天（跨月/跨年自动进位） */
export declare function addDays(key: DateKey, days: number): DateKey;
/** 日期键所属月份键 */
export declare function monthKeyOf(key: DateKey): MonthKey;
/** 月份键 ± N 月 */
export declare function shiftMonth(month: MonthKey, delta: number): MonthKey;
/** 该月第一天 / 最后一天 / 天数 */
export declare function monthBounds(month: MonthKey): {
    first: DateKey;
    last: DateKey;
    days: number;
};
/**
 * ISO 8601 周号（1-53）：用"该周周四"定周——这是 ISO 的定义，也是周数列唯一稳妥的算法
 * （直接按 1 月 1 日算会在跨年周上错，比如 12/31 属于下一年的第 1 周）。
 */
export declare function isoWeekNumber(key: DateKey): number;
/**
 * 生成月历网格（整周对齐）：从该月第一天的所在周开始，到该月最后一天的所在周结束。
 * @param weekStart 0=周日开头 / 1=周一开头（Note Calendar 的"一周起始日"配置项）
 */
export declare function monthGrid(month: MonthKey, weekStart?: 0 | 1): CalendarWeek[];
/** 月份标题：'2026-10' → '2026 年 10 月' */
export declare function formatMonthTitle(month: MonthKey): string;
/** 日期标题：'2026-10-05' → '2026 年 10 月 5 日 周一' */
export declare function formatDateLabel(key: DateKey): string;
/** 日历以哪个日期打点 */
export type TodoDateField = 'due' | 'scheduled';
/** 取一条待办在指定字段上的日期键 */
export declare function todoDateOf(todo: TodoItem, field: TodoDateField): DateKey | null;
/** 某一天的待办（按 order 稳定排序）；不含已完成？——由调用方决定，这里都给 */
export declare function todosOnDate(todos: TodoItem[], key: DateKey, field: TodoDateField): TodoItem[];
/** 未排期（收集箱）：计划日期与截止日期都没有 */
export declare function unscheduledTodos(todos: TodoItem[]): TodoItem[];
/**
 * 逾期：有截止日期、早于今天、且还没完成。
 * 只按**截止日期**算逾期——计划日期过期不是逾期（"我打算昨天做"没做成不算欠债）。
 */
export declare function overdueTodos(todos: TodoItem[], today?: DateKey): TodoItem[];
/** 单元格圆点：某天有未完成 / 已完成各几件（0 就不显示那个颜色的点） */
export interface TodoDayCount {
    open: number;
    done: number;
}
/** 按月历格子需要的形状统计：日期键 → {open, done}（只含有待办的日期） */
export declare function todoCountsByDate(todos: TodoItem[], field: TodoDateField): Record<DateKey, TodoDayCount>;
/** 汇总：今天要做的 / 逾期的 / 未排期的（面板顶部那三块数字） */
export declare function todoDigest(todos: TodoItem[], today?: DateKey, field?: TodoDateField): {
    todayOpen: number;
    todayDone: number;
    overdue: number;
    unscheduled: number;
    done: number;
    total: number;
};
