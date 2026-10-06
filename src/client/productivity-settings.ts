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
    const [error, setError] = useState('');
    useEffect(() => {
      let alive = true;
      productivityBridge
        .load()
        .then((value) => {
          if (alive) setSnapshot(value);
        })
        .catch((e) => setError(String(e)));
      const timer = window.setInterval(() => {
        const current = productivityBridge.reconcile();
        if (current && alive) setSnapshot({ ...current });
      }, 1000);
      return () => {
        alive = false;
        window.clearInterval(timer);
      };
    }, []);
    if (!snapshot) return h('div', { className: 'dsh-settings-section', children: error || '加载中…' });
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
        // 待办清单已独立：这里**不再**提供编辑入口。
        // 之前它写的是 productivity.json 里的遗留 todos 数组——那份数据现在没人读，
        // 用户在这里加的任务不会出现在「待办日历」里，属于"看起来能用其实无效"的陷阱，必须去掉。
        h('h3', { children: '待办清单' }),
        h('p', {
          children:
            '待办已独立为「待办日历」（月历排期 / 截止与计划日期 / 收集箱 / 逾期 / 农历与调休）。' +
            '桌宠上右键菜单选「待办日历」即可打开；数据存在 ~/.dsh/dsh-pet-desktop/todos.json。',
        }),
        error ? h('p', { children: error }) : null,
      ],
    });
  };
}
