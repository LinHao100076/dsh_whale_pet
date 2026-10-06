/**
 * 「待办日历」独立存储测试：校验/归一化、纯归约、原子读写、损坏备份、老数据迁移。
 *
 * 这块是**用户原始数据**的落盘口，所以每条不变量都要钉住：
 *   ① 老数据（没有日期字段的 productivity.json todo）读取时要被补齐，而不是报错；
 *   ② 重复 id / 结构非法 → 抛错（绝不静默写出一份坏文件）；
 *   ③ 文件损坏 → **先备份再继续**（用户数据不能因为一个坏字节就永远打不开面板）；
 *   ④ 迁移只做一次，且"用户把待办全删光之后的合法空清单"**绝不能被重新迁移复活**。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TODO_FILE,
  applyTodoAction,
  configureTodoStore,
  createTodoDocument,
  ensureTodoStore,
  loadTodos,
  mutateTodos,
  readTodoDocument,
  validateTodoDocument,
  writeTodoDocument,
  type TodoDocument,
} from './todo-store.ts';
import type { TodoItem } from '../shared/todo.ts';

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-todo-'));
  const done = (): void => rmSync(dir, { recursive: true, force: true });
  try {
    const result = fn(dir);
    if (result instanceof Promise) return result.finally(done);
    done();
    return undefined;
  } catch (error) {
    done();
    throw error;
  }
}

const legacyTodo = {
  id: 'a',
  title: '老数据',
  notes: '',
  completed: false,
  estimatedPomodoros: 2,
  completedPomodoros: 1,
  order: 0,
  createdAt: 1,
  updatedAt: 2,
};

describe('校验与归一化', () => {
  test('老数据缺日期字段 → 补齐 null（不报错）', () => {
    const doc = validateTodoDocument({ version: 1, todos: [legacyTodo] });
    assert.deepEqual(doc.todos[0].dueDate, null);
    assert.deepEqual(doc.todos[0].scheduledDate, null);
    assert.deepEqual(doc.todos[0].completedAt, null);
    assert.equal(doc.todos[0].title, '老数据');
  });

  test('结构非法 → 抛错（版本、todos 数组、单条字段）', () => {
    assert.throws(() => validateTodoDocument(null), /Invalid todo document/);
    assert.throws(() => validateTodoDocument({ version: 2, todos: [] }), /schema/);
    assert.throws(() => validateTodoDocument({ version: 1, todos: {} }), /schema/);
    assert.throws(() => validateTodoDocument({ version: 1, todos: [{ ...legacyTodo, id: '' }] }), /Invalid Todo item/);
    assert.throws(
      () => validateTodoDocument({ version: 1, todos: [{ ...legacyTodo, title: '  ' }] }),
      /Invalid Todo item/,
    );
  });

  test('重复 id → 抛错（id 是程序的唯一定位）', () => {
    assert.throws(
      () => validateTodoDocument({ version: 1, todos: [legacyTodo, { ...legacyTodo, title: '另一条' }] }),
      /Duplicate Todo id/,
    );
  });

  test('非法日期字段被归一成 null（坏值不该让整份文件打不开）', () => {
    const doc = validateTodoDocument({
      version: 1,
      todos: [{ ...legacyTodo, dueDate: '2026-02-30', scheduledDate: '2026-10-05' }],
    });
    assert.equal(doc.todos[0].dueDate, null);
    assert.equal(doc.todos[0].scheduledDate, '2026-10-05');
  });
});

describe('纯归约：动作 → 新文档（不碰磁盘）', () => {
  const now = 1_000;
  const base = (todos: TodoItem[] = []): TodoDocument => ({ version: 1, todos });

  test('create：写进 order/时间戳，日期可给可不给', () => {
    const next = applyTodoAction(base(), { type: 'create', todo: { title: '写 README' } }, now);
    assert.equal(next.todos.length, 1);
    assert.equal(next.todos[0].title, '写 README');
    assert.equal(next.todos[0].dueDate, null);
    assert.equal(next.todos[0].order, 0);
    assert.equal(next.todos[0].createdAt, now);
    const dated = applyTodoAction(base(), { type: 'create', todo: { title: 'x', dueDate: '2026-10-05' } }, now);
    assert.equal(dated.todos[0].dueDate, '2026-10-05');
  });

  test('create：非法日期抛错（路由层据此回 400）', () => {
    assert.throws(
      () => applyTodoAction(base(), { type: 'create', todo: { title: 'x', dueDate: '2026-13-01' } }, now),
      /dueDate/,
    );
  });

  test('complete：完成记 completedAt，取消时清掉', () => {
    const doc = base([{ ...applyTodoAction(base(), { type: 'create', todo: { title: 'x' } }, now).todos[0] }]);
    const id = doc.todos[0].id;
    const done = applyTodoAction(doc, { type: 'complete', id, completed: true }, 5_000);
    assert.equal(done.todos[0].completed, true);
    assert.equal(done.todos[0].completedAt, 5_000);
    const undone = applyTodoAction(done, { type: 'complete', id, completed: false }, 6_000);
    assert.equal(undone.todos[0].completed, false);
    assert.equal(undone.todos[0].completedAt, null);
  });

  test('reschedule：只动给定字段，另一个保持原样；两个都给就都改', () => {
    const created = applyTodoAction(base(), { type: 'create', todo: { title: 'x', dueDate: '2026-10-05' } }, now);
    const id = created.todos[0].id;
    const scheduled = applyTodoAction(created, { type: 'reschedule', id, patch: { scheduledDate: '2026-10-06' } }, now);
    assert.equal(scheduled.todos[0].scheduledDate, '2026-10-06');
    assert.equal(scheduled.todos[0].dueDate, '2026-10-05', '没给的字段不能被动');
    const cleared = applyTodoAction(scheduled, { type: 'reschedule', id, patch: { dueDate: null } }, now);
    assert.equal(cleared.todos[0].dueDate, null);
    assert.equal(cleared.todos[0].scheduledDate, '2026-10-06');
  });

  test('update / delete / reorder / focus', () => {
    let doc = applyTodoAction(base(), { type: 'create', todo: { title: 'a' } }, now);
    doc = applyTodoAction(doc, { type: 'create', todo: { title: 'b' } }, now);
    const [a, b] = doc.todos;
    assert.equal(
      applyTodoAction(doc, { type: 'update', id: a.id, patch: { title: ' a2 ' } }, now).todos[0].title,
      'a2',
    );
    assert.equal(applyTodoAction(doc, { type: 'delete', id: a.id }, now).todos.length, 1);
    assert.deepEqual(
      applyTodoAction(doc, { type: 'reorder', orderedIds: [b.id, a.id] }, now).todos.map((t) => t.title),
      ['b', 'a'],
    );
    assert.equal(applyTodoAction(doc, { type: 'focus', id: a.id }, now).todos[0].completedPomodoros, 1);
    assert.equal(applyTodoAction(doc, { type: 'focus', id: null }, now).todos[0].completedPomodoros, 0);
  });
});

describe('读写：原子落盘 / 缺文件 / 损坏备份', () => {
  test('写→读 往返一致（含日期字段）', () =>
    withTempDir(async (dir) => {
      const doc: TodoDocument = {
        version: 1,
        todos: [
          {
            id: 'x',
            title: '带日期的',
            notes: '',
            completed: false,
            estimatedPomodoros: 1,
            completedPomodoros: 0,
            order: 0,
            createdAt: 1,
            updatedAt: 1,
            dueDate: '2026-10-05',
            scheduledDate: '2026-10-04',
            completedAt: null,
          },
        ],
      };
      await writeTodoDocument(dir, doc);
      assert.ok(existsSync(join(dir, TODO_FILE)));
      const back = await loadTodos(dir);
      assert.deepEqual(back.todos, doc.todos);
      // 落盘形态是可读的 JSON（带换行），不是压缩成一行的
      assert.ok(readFileSync(join(dir, TODO_FILE), 'utf8').endsWith('\n'));
    }));

  test('文件不存在 → 空文档（不抛错）', () =>
    withTempDir(async (dir) => {
      const { doc, recoveredFrom } = await readTodoDocument(dir);
      assert.deepEqual(doc, createTodoDocument());
      assert.equal(recoveredFrom, undefined);
    }));

  test('文件损坏 → 备份原文件 + 以空清单继续 + 上报一次', () =>
    withTempDir(async (dir) => {
      writeFileSync(join(dir, TODO_FILE), '{ 这不是 JSON', 'utf8');
      const warns: string[] = [];
      const { doc, recoveredFrom } = await readTodoDocument(dir, (m) => warns.push(m));
      assert.deepEqual(doc.todos, []);
      assert.ok(recoveredFrom && existsSync(recoveredFrom), '备份文件必须存在');
      assert.equal(readFileSync(recoveredFrom as string, 'utf8'), '{ 这不是 JSON', '备份必须是原文');
      assert.equal(warns.length, 1);
      assert.match(warns[0], /备份/);
      assert.equal(readdirSync(dir).filter((f) => f === TODO_FILE).length, 0, '坏文件被移走，等下一次写入重建');
    }));
});

describe('迁移：从 productivity.json 一次性搬过来', () => {
  test('无 todos.json + 老快照有待办 → 迁移并落盘（补齐日期字段）', async () => {
    await withTempDir(async (dir) => {
      const warns: string[] = [];
      configureTodoStore({ warn: (m) => warns.push(m), readLegacy: async () => ({ todos: [legacyTodo] }) });
      const doc = await ensureTodoStore(dir);
      assert.equal(doc.todos.length, 1);
      assert.equal(doc.todos[0].dueDate, null);
      assert.ok(existsSync(join(dir, TODO_FILE)), '迁移结果必须落盘');
      assert.match(warns.join(''), /迁移 1 条待办/);
      configureTodoStore({});
    });
  });

  test('迁移只做一次：之后再跑不会重复搬（老文件后续变化也不影响）', async () => {
    await withTempDir(async (dir) => {
      let legacyCalls = 0;
      configureTodoStore({
        readLegacy: async () => {
          legacyCalls += 1;
          return { todos: [legacyTodo] };
        },
      });
      await ensureTodoStore(dir);
      await ensureTodoStore(dir);
      assert.equal(legacyCalls, 1, 'todos.json 已存在时不该再去读老快照');
      configureTodoStore({});
    });
  });

  test('用户把待办全删光后的**合法空清单** → 绝不能被老数据复活', async () => {
    await withTempDir(async (dir) => {
      // 先迁移出 1 条，再删光（写成合法的空清单）
      configureTodoStore({ readLegacy: async () => ({ todos: [legacyTodo] }) });
      await ensureTodoStore(dir);
      await writeTodoDocument(dir, createTodoDocument());
      // 再启动一次：文件存在（即使是空的）→ 不该再迁移
      let legacyCalls = 0;
      configureTodoStore({
        readLegacy: async () => {
          legacyCalls += 1;
          return { todos: [legacyTodo] };
        },
      });
      const doc = await ensureTodoStore(dir);
      assert.deepEqual(doc.todos, []);
      assert.equal(legacyCalls, 0, '文件存在时一次都不该读老快照');
      configureTodoStore({});
    });
  });

  test('老快照读取失败 → 只告警，不阻塞（空清单继续）', async () => {
    await withTempDir(async (dir) => {
      const warns: string[] = [];
      configureTodoStore({
        warn: (m) => warns.push(m),
        readLegacy: async () => {
          throw new Error('productivity.json 炸了');
        },
      });
      const doc = await ensureTodoStore(dir);
      assert.deepEqual(doc.todos, []);
      assert.match(warns.join(''), /迁移失败/);
      configureTodoStore({});
    });
  });
});

describe('串行写：mutate 是读-改-写的原子单位', () => {
  test('并发两次 create 不会互相覆盖（进程内串行队列）', async () => {
    await withTempDir(async (dir) => {
      configureTodoStore({});
      await writeTodoDocument(dir, createTodoDocument());
      await Promise.all([
        mutateTodos(dir, { type: 'create', todo: { title: '并发 A' } }, 1),
        mutateTodos(dir, { type: 'create', todo: { title: '并发 B' } }, 2),
      ]);
      const doc = await loadTodos(dir);
      assert.equal(doc.todos.length, 2, '两条都必须留下');
      assert.deepEqual(doc.todos.map((t) => t.title).sort(), ['并发 A', '并发 B']);
    });
  });
});
