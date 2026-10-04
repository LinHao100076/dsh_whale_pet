import type { ProductivitySnapshot } from '../host/productivity-store';
import { advanceTimer, pauseTimer, resetTimer, resumeTimer, skipTimer, startTimer } from '../shared/pomodoro';

export const productivityBridge = {
  current: null as ProductivitySnapshot | null,
  async load(): Promise<ProductivitySnapshot> {
    const response = await fetch('/dsh-pet-desktop-7340/productivity');
    if (!response.ok) throw new Error('加载生产力数据失败');
    this.current = (await response.json()) as ProductivitySnapshot;
    return this.current;
  },
  async save(snapshot: ProductivitySnapshot): Promise<ProductivitySnapshot> {
    const response = await fetch('/dsh-pet-desktop-7340/productivity', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error('保存生产力数据失败');
    this.current = (await response.json()) as ProductivitySnapshot;
    return this.current;
  },
  async action(
    action: 'start' | 'pause' | 'resume' | 'skip' | 'reset',
    todoId?: string | null,
  ): Promise<ProductivitySnapshot> {
    const snapshot = this.current ?? (await this.load());
    const now = Date.now();
    const state = snapshot.pomodoro.state;
    const next =
      action === 'start'
        ? startTimer(state, todoId ?? state.todoId, now, snapshot.pomodoro.settings)
        : action === 'pause'
          ? pauseTimer(state, now)
          : action === 'resume'
            ? resumeTimer(state, now)
            : action === 'skip'
              ? skipTimer(state, now, snapshot.pomodoro.settings).state
              : resetTimer(state, snapshot.pomodoro.settings);
    return this.save({ ...snapshot, pomodoro: { ...snapshot.pomodoro, state: next } });
  },
  reconcile(now = Date.now()): ProductivitySnapshot | null {
    if (!this.current) return null;
    const result = advanceTimer(this.current.pomodoro.state, now, this.current.pomodoro.settings);
    if (result.state === this.current.pomodoro.state) return this.current;
    this.current = { ...this.current, pomodoro: { ...this.current.pomodoro, state: result.state } };
    return this.current;
  },
};
