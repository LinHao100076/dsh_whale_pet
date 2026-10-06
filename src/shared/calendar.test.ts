/**
 * 日历纯逻辑测试（月历网格 / 周数列 / 日期键 / 待办分组统计）。
 *
 * 这些是「待办日历」的地基，错一天整块 UI 就错位，所以逐条钉死：
 *   ① 日期键必须是**本地日期**（UTC 陷阱：toISOString 在东八区晚上 8 点后会算成明天）；
 *   ② ISO 周号按"该周周四"定周（跨年周是唯一会算错的地方，必须有用例）；
 *   ③ 月历网格：整周对齐、补位日标记、行周号与格内周号一致、周起始日可配；
 *   ④ 待办视角：某天清单、收集箱、逾期（只看截止日）、圆点计数、汇总。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  dateKeyOf,
  formatDateLabel,
  formatMonthTitle,
  isMonthKey,
  isoWeekNumber,
  monthBounds,
  monthGrid,
  monthKeyOf,
  overdueTodos,
  parseDateKey,
  shiftMonth,
  todayKey,
  todoCountsByDate,
  todoDigest,
  todosOnDate,
  unscheduledTodos,
} from '../shared/calendar.ts';
import { isDateKeyValue, type TodoItem } from '../shared/todo.ts';

/** 造一条待办（只给关心的字段） */
function todo(over: Partial<TodoItem> & { id: string }): TodoItem {
  return {
    title: over.id,
    notes: '',
    completed: false,
    estimatedPomodoros: 1,
    completedPomodoros: 0,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    dueDate: null,
    scheduledDate: null,
    completedAt: null,
    ...over,
  };
}

describe('日期键：必须是本地日期，且拒绝不存在的日期', () => {
  test('合法键', () => {
    for (const key of ['2026-01-01', '2026-12-31', '2024-02-29']) assert.equal(isDateKeyValue(key), true, key);
  });

  test('非法键（格式 / 不存在的日期 / 非字符串）', () => {
    for (const key of [
      '2026-2-1',
      '2026-13-01',
      '2026-00-10',
      '2026-02-30',
      '2025-02-29',
      '2026/01/01',
      '',
      'today',
      20260101,
    ]) {
      assert.equal(isDateKeyValue(key), false, JSON.stringify(key));
    }
  });

  test('本地日期：用本地字段拼键，而不是 toISOString（UTC 会串天）', () => {
    // 本地时间 2026-01-01 00:30 在东八区时，toISOString() 会给出 2025-12-31
    const local = new Date(2026, 0, 1, 0, 30);
    assert.equal(dateKeyOf(local), '2026-01-01');
    // 再来一个"晚上"的时刻，确认不会被推到第二天
    assert.equal(dateKeyOf(new Date(2026, 0, 1, 23, 59)), '2026-01-01');
  });

  test('todayKey 走本地时区', () => {
    const now = new Date(2026, 9, 5, 13, 0).getTime();
    assert.equal(todayKey(now), '2026-10-05');
  });

  test('parseDateKey 构造的是本地零点，非法键抛错', () => {
    const d = parseDateKey('2026-10-05');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 0);
    assert.throws(() => parseDateKey('2026-02-30'), /Invalid date key/);
  });
});

describe('日期算术：跨月/跨年自动进位', () => {
  test('addDays 正负与跨月跨年', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // 闰年
    assert.equal(addDays('2026-10-05', 7), '2026-10-12');
  });

  test('shiftMonth 正负与跨年', () => {
    assert.equal(shiftMonth('2026-10', 1), '2026-11');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-01', -13), '2024-12');
  });

  test('monthBounds：天数（含闰年二月）与首尾日期', () => {
    assert.deepEqual(monthBounds('2026-02'), { first: '2026-02-01', last: '2026-02-28', days: 28 });
    assert.deepEqual(monthBounds('2024-02'), { first: '2024-02-01', last: '2024-02-29', days: 29 });
    assert.equal(monthBounds('2026-10').days, 31);
  });

  test('monthKeyOf / isMonthKey', () => {
    assert.equal(monthKeyOf('2026-10-05'), '2026-10');
    assert.equal(isMonthKey('2026-10'), true);
    assert.equal(isMonthKey('2026-13'), false);
    assert.equal(isMonthKey('2026-1'), false);
  });
});

describe('ISO 周号：按"该周周四"定周（跨年是唯一会算错的地方）', () => {
  test('常规周', () => {
    assert.equal(isoWeekNumber('2026-01-01'), 1); // 2026-01-01 是周四 → 第 1 周
    assert.equal(isoWeekNumber('2026-10-05'), 41);
  });

  test('跨年周：12/31 可能属于下一年的第 1 周，1/1 也可能属于上一年的最后一周', () => {
    // 2027-01-01 是周五 → 属于 2026 年的第 53 周
    assert.equal(isoWeekNumber('2027-01-01'), 53);
    // 2025-12-29（周一）属于 2026 年第 1 周
    assert.equal(isoWeekNumber('2025-12-29'), 1);
    assert.equal(isoWeekNumber('2025-12-28'), 52); // 前一天还是上一周
  });

  test('同一周内 7 天的周号一致', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    const numbers = new Set(week.map(isoWeekNumber));
    assert.equal(numbers.size, 1, [...numbers].join(','));
    assert.equal([...numbers][0], 41);
  });
});

describe('月历网格：整周对齐、补位标记、周号一致、起始日可配', () => {
  test('周一起始：2026-10 的第一格是 9/28（周一），最后一格是 11/1（周日）', () => {
    const weeks = monthGrid('2026-10', 1);
    const flat = weeks.flatMap((w) => w.days);
    assert.equal(flat[0].key, '2026-09-28');
    assert.equal(flat[flat.length - 1].key, '2026-11-01');
    assert.equal(flat.length % 7, 0, '必须整周对齐');
    assert.equal(flat.length / 7, weeks.length);
  });

  test('每格都有自己那天的日号，补位日 inMonth=false', () => {
    const weeks = monthGrid('2026-10', 1);
    const flat = weeks.flatMap((w) => w.days);
    for (const day of flat) {
      assert.equal(day.day, Number(day.key.slice(8, 10)));
      assert.equal(day.inMonth, day.key.startsWith('2026-10'));
    }
    assert.equal(flat.filter((d) => d.inMonth).length, 31, '十月的 31 天都要在');
  });

  test('行周号 = 该行周四的 ISO 周号（跨年行也正确）', () => {
    for (const month of ['2025-12', '2026-01', '2026-10']) {
      for (const week of monthGrid(month, 1)) {
        assert.equal(week.week, isoWeekNumber(addDays(week.days[0].key, 3)), month);
        assert.equal(week.days[0].week, isoWeekNumber(week.days[0].key), '格内周号与自己的日期一致');
      }
    }
  });

  test('周日起始：首格变成周日，且总格数仍是 7 的倍数', () => {
    const weeks = monthGrid('2026-10', 0);
    const flat = weeks.flatMap((w) => w.days);
    assert.equal(parseDateKey(flat[0].key).getDay(), 0, '第一格必须是周日');
    assert.equal(flat.length % 7, 0);
  });

  test('二月（闰年/平年）网格也整周对齐', () => {
    for (const month of ['2026-02', '2024-02']) {
      const flat = monthGrid(month, 1).flatMap((w) => w.days);
      assert.equal(flat.length % 7, 0);
      assert.equal(flat.filter((d) => d.inMonth).length, month === '2024-02' ? 29 : 28);
    }
  });
});

describe('标题格式化', () => {
  test('月份与日期标题', () => {
    assert.equal(formatMonthTitle('2026-10'), '2026 年 10 月');
    assert.equal(formatDateLabel('2026-10-05'), '2026 年 10 月 5 日 周一');
    assert.equal(formatDateLabel('2026-10-11'), '2026 年 10 月 11 日 周日');
  });
});

describe('待办视角：某天清单 / 收集箱 / 逾期 / 圆点 / 汇总', () => {
  const todos: TodoItem[] = [
    todo({ id: 'a', dueDate: '2026-10-05', order: 1 }),
    todo({ id: 'b', dueDate: '2026-10-05', order: 0 }),
    todo({ id: 'c', dueDate: '2026-10-05', completed: true, completedAt: 1, order: 2 }),
    todo({ id: 'd', dueDate: '2026-10-01' }), // 逾期
    todo({ id: 'e', scheduledDate: '2026-10-05' }), // 计划在当天、无截止
    todo({ id: 'f' }), // 收集箱
    todo({ id: 'g', dueDate: '2026-10-20' }),
  ];

  test('某天的待办按 order 稳定排序；字段可选（due / scheduled）', () => {
    assert.deepEqual(
      todosOnDate(todos, '2026-10-05', 'due').map((t) => t.id),
      ['b', 'a', 'c'],
    );
    assert.deepEqual(
      todosOnDate(todos, '2026-10-05', 'scheduled').map((t) => t.id),
      ['e'],
    );
    assert.deepEqual(todosOnDate(todos, '2026-10-06', 'due'), []);
  });

  test('收集箱 = 两个日期都没有', () => {
    assert.deepEqual(
      unscheduledTodos(todos).map((t) => t.id),
      ['f'],
    );
  });

  test('逾期：只看截止日期、排除已完成、按日期升序', () => {
    assert.deepEqual(
      overdueTodos(todos, '2026-10-05').map((t) => t.id),
      ['d'],
    );
    // 当天到期不算逾期
    assert.equal(overdueTodos(todos, '2026-10-01').length, 0);
    // 已完成的即使过期也不算
    const done = [todo({ id: 'x', dueDate: '2020-01-01', completed: true })];
    assert.equal(overdueTodos(done, '2026-10-05').length, 0);
  });

  test('圆点计数：按天分未完成/已完成', () => {
    const counts = todoCountsByDate(todos, 'due');
    assert.deepEqual(counts['2026-10-05'], { open: 2, done: 1 });
    assert.deepEqual(counts['2026-10-01'], { open: 1, done: 0 });
    assert.deepEqual(counts['2026-10-20'], { open: 1, done: 0 });
    assert.equal('2026-10-06' in counts, false, '没待办的日期不该出现在计数表里');
    // 计划视角只看计划日期
    const byScheduled = todoCountsByDate(todos, 'scheduled');
    assert.deepEqual(Object.keys(byScheduled), ['2026-10-05']);
  });

  test('汇总：今天未完成/已完成、逾期、收集箱、总数', () => {
    const digest = todoDigest(todos, '2026-10-05', 'due');
    assert.deepEqual(digest, { todayOpen: 2, todayDone: 1, overdue: 1, unscheduled: 1, done: 1, total: 7 });
  });
});
