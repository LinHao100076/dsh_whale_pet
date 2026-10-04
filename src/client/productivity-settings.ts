/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FunctionComponent } from 'react';
import type { jsx } from 'react/jsx-runtime';
import { productivityBridge } from './productivity';

export function makeProductivitySection({
  h,
  useState,
  useEffect,
  t,
}: {
  h: typeof jsx;
  useState: any;
  useEffect: any;
  t: (key: string) => string;
}): FunctionComponent {
  return function ProductivitySection() {
    const [snapshot, setSnapshot] = useState(productivityBridge.current);
    const [title, setTitle] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
      let alive = true;
      productivityBridge
        .load()
        .then((value) => { if (alive) setSnapshot(value); })
        .catch((e) => setError(String(e)));
      const timer = window.setInterval(() => {
        const current = productivityBridge.reconcile();
        if (current && alive) setSnapshot({ ...current });
      }, 1000);
      return () => { alive = false; window.clearInterval(timer); };
    }, []);
    if (!snapshot) return h('div', { className: 'dsh-settings-section', children: error || '加载中…' });
    const save = async (next: typeof snapshot) => {
      try {
        setSnapshot(await productivityBridge.save(next));
        setError('');
      } catch (e) {
        setError(String(e));
      }
    };
    const add = () => {
      const value = title.trim();
      if (!value) return;
      const now = Date.now();
      const item = {
        id: crypto.randomUUID(),
        title: value,
        notes: '',
        completed: false,
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        order: snapshot.todos.length,
        createdAt: now,
        updatedAt: now,
      };
      void save({ ...snapshot, todos: [...snapshot.todos, item] });
      setTitle('');
    };
    const timer = snapshot.pomodoro.state;
    return h('div', {
      className: 'dsh-settings-section',
      children: [
        h('h2', { children: t('productivity.nav') }),
        h('p', {
          children: `${timer.phase} · ${Math.ceil(timer.remainingSeconds / 60)} 分钟 · ${timer.running ? '运行中' : '已暂停'}`,
        }),
        h('button', {
          onClick: () => productivityBridge.action(timer.running ? 'pause' : 'start').then(setSnapshot),
          children: timer.running ? '暂停' : '开始',
        }),
        h('button', { onClick: () => productivityBridge.action('reset').then(setSnapshot), children: '重置' }),
        h('h3', { children: 'Todo' }),
        h('div', {
          children: [
            h('input', {
              value: title,
              onInput: (e: any) => setTitle(e.currentTarget.value),
              placeholder: '新增 Todo',
            }),
            h('button', { onClick: add, children: '添加' }),
          ],
        }),
        h('ul', {
          children: snapshot.todos.map((todo: any) =>
            h('li', {
              key: todo.id,
              children: [
                h('input', {
                  type: 'checkbox',
                  checked: todo.completed,
                  onChange: (e: any) =>
                    save({
                      ...snapshot,
                      todos: snapshot.todos.map((x: any) =>
                        x.id === todo.id ? { ...x, completed: e.currentTarget.checked, updatedAt: Date.now() } : x,
                      ),
                    }),
                }),
                `${todo.title} (${todo.completedPomodoros}/${todo.estimatedPomodoros})`,
              ],
            }),
          ),
        }),
        error ? h('p', { children: error }) : null,
      ],
    });
  };
}
