/**
 * 「待办日历」面板（src/shared，浏览器与桌面宠物窗口共用一份 DOM）。
 *
 * 参考 Obsidian 的 Note Calendar：左侧月历（含周数列）+ 单元格圆点 + 选中日期看当天条目。
 * 在此之上补了待办特有的三块：**未排期收集箱**、**逾期分组**、**拖拽改期**。
 *
 * 与 productivity-panel 的取舍差异：
 *   - 数据源是独立存储 `todos.json`（走 /todo 与 /todo/action），**不再读写 productivity.json**；
 *   - 所有改动都是"提交一个动作 → 用返回的整份清单重渲染"，不做本地乐观更新后对账
 *     （待办是低频操作，简单可靠优先；重渲染只重建右侧列表与格子圆点，成本极低）；
 *   - 日期全部用**本地日期键**（见 shared/calendar.ts 的说明），绝不用 toISOString。
 *
 * 农历/节气/调休的标注（Stage 3）会从 /todo/calendar 接口拿到"某天的附加文字"，
 * 本文件只负责渲染——不引入农历库，保证两端 bundle 都不背这个包袱。
 */

import {
  formatDateLabel,
  formatMonthTitle,
  monthGrid,
  monthKeyOf,
  overdueTodos,
  shiftMonth,
  todayKey,
  todoCountsByDate,
  todoDigest,
  todosOnDate,
  unscheduledTodos,
  type CalendarWeek,
  type DateKey,
  type MonthKey,
  type TodoDateField,
} from './calendar';
import type { TodoItem } from './todo';

export interface TodoPanelOptions {
  onOpenChange?: (open: boolean) => void;
  /** 打开时的初始视图（截止/计划），默认按截止 */
  initialField?: TodoDateField;
}

interface TodoDocumentResponse {
  ok?: boolean;
  version?: number;
  todos?: TodoItem[];
  error?: string;
}

const CSS = `
/* 与配置面板同一套「气泡框」观感：无遮罩、白色圆润泡 + 底部小尾巴、上首软糖体 */
.dshtd-backdrop{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box;background:transparent;pointer-events:auto;font:14px/1.55 'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;color:#2b2b2b}
.dshtd-backdrop *{box-sizing:border-box}
.dshtd-card{position:relative;width:min(960px,100%);max-height:min(900px,95vh);display:flex;flex-direction:column;border-radius:24px;background:rgba(255,255,255,.97);box-shadow:0 18px 52px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.08)}
.dshtd-card::after{content:"";position:absolute;left:50%;bottom:-13px;transform:translateX(-50%);border:13px solid transparent;border-top-color:rgba(255,255,255,.97);border-bottom:none}
.dshtd-head{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;border-radius:24px 24px 0 0;border-bottom:1px solid rgba(43,43,43,.07);background:rgba(246,248,252,.72)}
.dshtd-mark{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(145deg,#dbeafe,#ede9fe);font-size:19px}
.dshtd-heading{min-width:0;flex:1}.dshtd-title{margin:0;font-size:18px;font-weight:700;color:#1f2a44}.dshtd-subtitle{margin:3px 0 0;color:#78849a;font-size:12px}
.dshtd-close{width:32px;height:32px;border:0;border-radius:10px;background:#f0f2f7;color:#68748a;font-size:19px;line-height:1;cursor:pointer}.dshtd-close:hover{background:#e4e8f0;color:#253149}
.dshtd-content{overflow:auto;padding:14px 18px 18px;border-radius:0 0 24px 24px;scrollbar-width:thin;scrollbar-color:#c8cfdb transparent}
.dshtd-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.dshtd-month{font-size:16px;font-weight:700;color:#313d57;margin-left:2px}
.dshtd-spacer{flex:1}
.dshtd-status{font-size:12px;color:#64748b;min-height:18px}.dshtd-status[data-kind=ok]{color:#17804a}.dshtd-status[data-kind=error]{color:#c13e4b}
.dshtd-digest{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.dshtd-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#f1f4fa;color:#4a5670;font-size:12px}
.dshtd-chip b{font-weight:700;color:#2b3550}
.dshtd-chip.is-overdue{background:#ffeceb;color:#b23c34}.dshtd-chip.is-overdue b{color:#b23c34}
.dshtd-chip.is-inbox{background:#eef6ee;color:#2f6b40}.dshtd-chip.is-inbox b{color:#2f6b40}
.dshtd-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:16px;align-items:start}
.dshtd-cal{border:1px solid rgba(43,43,43,.09);border-radius:16px;padding:10px;background:rgba(249,250,253,.9)}
.dshtd-weekdays,.dshtd-week{display:grid;grid-template-columns:34px repeat(7,minmax(0,1fr));gap:4px}
.dshtd-weekdays{margin-bottom:4px;font-size:11px;color:#8a94a6;text-align:center}
.dshtd-weekno{display:grid;place-items:center;font-size:11px;color:#a7b0c0;font-variant-numeric:tabular-nums}
.dshtd-day{position:relative;min-height:52px;padding:4px 5px;border-radius:10px;border:1px solid transparent;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}
.dshtd-day:hover{border-color:#c3cdf7}
.dshtd-day[data-out=true]{background:rgba(255,255,255,.45);color:#a7b0c0}
.dshtd-day[data-today=true] .dshtd-daynum{color:#4d61d8;font-weight:800}
.dshtd-day[data-selected=true]{border-color:#6d7ff0;box-shadow:0 0 0 2px rgba(109,127,240,.18)}
.dshtd-day[data-drop=true]{border-color:#2f9e57;background:#f1fbf4}
.dshtd-daynum{font-size:13px;font-weight:650;color:#3b465e}
.dshtd-daylunar{font-size:10px;color:#98a1b2;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshtd-daylunar.is-festival{color:#c9603f}
.dshtd-dayflag{position:absolute;right:4px;top:3px;font-size:10px;line-height:1;padding:1px 3px;border-radius:4px;border:1px solid currentColor}
.dshtd-dayflag.is-off{color:#3f8f5b}.dshtd-dayflag.is-work{color:#b4763a}
.dshtd-dots{display:flex;align-items:center;gap:3px;margin-top:auto}
.dshtd-dot{width:6px;height:6px;border-radius:50%;flex:none}
.dshtd-dot.is-open{background:#6d7ff0}.dshtd-dot.is-done{background:#43a86a}.dshtd-dot.is-over{background:#d9534f}
.dshtd-daycount{font-size:10px;color:#8a94a6;margin-left:auto}
.dshtd-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.dshtd-panel{border:1px solid rgba(43,43,43,.09);border-radius:14px;background:rgba(249,250,253,.9);padding:10px 12px}
.dshtd-panel-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dshtd-panel-title{font-size:13px;font-weight:740;color:#313d57}
.dshtd-panel-note{margin-left:auto;font-size:11px;color:#98a1b2}
.dshtd-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:260px;overflow:auto;scrollbar-width:thin}
.dshtd-item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border:1px solid rgba(43,43,43,.08);border-radius:10px;background:#fff}
.dshtd-item[draggable=true]{cursor:grab}
.dshtd-item[data-dragging=true]{opacity:.45}
.dshtd-item>input[type=checkbox]{width:16px;height:16px;flex:none;margin-top:2px;accent-color:#6477e8}
.dshtd-item-main{flex:1;min-width:0}
.dshtd-item-title{font-size:13px;color:#35415a;font-weight:650;overflow-wrap:anywhere}
.dshtd-item[data-completed=true] .dshtd-item-title{text-decoration:line-through;color:#99a1af}
.dshtd-item-meta{margin-top:2px;font-size:11px;color:#8892a5;display:flex;gap:6px;flex-wrap:wrap}
.dshtd-item-meta .is-due{color:#c9603f}.dshtd-item-meta .is-over{color:#b23c34;font-weight:700}
.dshtd-item-actions{display:flex;gap:4px;flex:none}
.dshtd-icon{min-width:28px;padding:4px 7px;border:0;border-radius:8px;background:#f0f2f7;color:#65718a;font-size:12px;cursor:pointer}
.dshtd-icon:hover{background:#e4e8f0;color:#253149}
.dshtd-edit{display:grid;gap:6px;width:100%}
.dshtd-edit input,.dshtd-edit textarea{width:100%;min-height:30px;padding:5px 8px;border:1px solid #dce2ed;border-radius:8px;background:#fff;font:inherit;color:#27334b;outline:none}
.dshtd-edit .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dshtd-edit .row label{font-size:11px;color:#7b879c;display:flex;align-items:center;gap:4px}
.dshtd-edit .row input[type=date]{width:auto;min-height:28px;padding:3px 6px}
.dshtd-new{display:flex;gap:6px;margin-bottom:8px}
.dshtd-new input{flex:1;min-height:32px;padding:6px 9px;border:1px solid #dce2ed;border-radius:9px;background:#fff;font:inherit;outline:none}
.dshtd-new button{border:0;border-radius:9px;padding:6px 12px;background:#586de8;color:#fff;font-weight:650;cursor:pointer}
.dshtd-new button:hover{background:#465cda}
.dshtd-empty{padding:10px;border:1px dashed #d6dce7;border-radius:10px;text-align:center;color:#8791a4;font-size:12px}
.dshtd-hint{margin:6px 0 0;font-size:11px;color:#8a94a6}
@media(max-width:820px){.dshtd-body{grid-template-columns:1fr}.dshtd-day{min-height:44px}}
`;

/** 只注入一次（与 productivity-panel 同模式） */
function injectTodoCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="dsh-pet-desktop/todo"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet-desktop';
  tag.dataset.pluginCss = 'dsh-pet-desktop/todo';
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(label: string, className = 'dshtd-icon'): HTMLButtonElement {
  return node('button', className, label);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = raw && typeof raw === 'object' && 'error' in raw ? String((raw as { error: unknown }).error) : '';
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (raw && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false) {
    throw new Error(String((raw as { error?: unknown }).error ?? '请求被拒绝'));
  }
  return raw as T;
}

/** 「待办日历」里某天的附加标注（Stage 3 的农历/节气/调休由 host 提供；现在允许为空） */
export interface TodoDayAnnotation {
  /** 农历日期文案（如「初二」/「腊月」） */
  lunar?: string;
  /** 节日/节气文案（如「中秋」「立秋」） */
  term?: string;
  /** 调休：'off' = 休（放假）/'work' = 班（调休上班）；缺省 = 普通日 */
  dayType?: 'off' | 'work' | null;
}

/**
 * 挂载待办日历面板。返回 { close }（与 productivity-panel 同契约）。
 * @param baseUrl 待办端点基址（如 '/dsh-pet-desktop-7340/todo' 或桌面端的 BASE + '/todo'）
 */
export function mountTodoPanel(baseUrl: string, options: TodoPanelOptions = {}): { close: () => void } {
  injectTodoCss();
  const actionUrl = baseUrl.replace(/\/$/, '') + '/action';
  /** 标记状态：用 'none' 而不是 null，避免和"还没选中"混淆 */
  let field: TodoDateField = options.initialField ?? 'due';
  let month: MonthKey = monthKeyOf(todayKey());
  let selected: DateKey = todayKey();
  let todos: TodoItem[] = [];
  let annotations: Record<DateKey, TodoDayAnnotation> = {};
  let editingId: string | null = null;
  let isClosed = false;

  const backdrop = node('div', 'dshtd-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  const card = node('div', 'dshtd-card');
  const head = node('div', 'dshtd-head');
  const mark = node('div', 'dshtd-mark', '📅');
  const heading = node('div', 'dshtd-heading');
  const title = node('h2', 'dshtd-title', '待办日历');
  title.id = 'dshtd-title';
  const subtitle = node('p', 'dshtd-subtitle', '月历排期 · 点日期看当天 · 拖到格子上改期');
  heading.append(title, subtitle);
  const closeButton = button('×', 'dshtd-close');
  closeButton.setAttribute('aria-label', '关闭');
  head.append(mark, heading, closeButton);
  const content = node('div', 'dshtd-content');
  card.append(head, content);
  backdrop.append(card);
  document.body.append(backdrop);
  backdrop.setAttribute('aria-labelledby', 'dshtd-title');

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    options.onOpenChange?.(false);
  };
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }
  closeButton.onclick = close;
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeyDown);
  options.onOpenChange?.(true);

  /** 状态条 */
  const status = node('p', 'dshtd-status');
  const setStatus = (text: string, kind: 'ok' | 'error' | '' = ''): void => {
    status.textContent = text;
    if (kind) status.dataset.kind = kind;
    else delete status.dataset.kind;
  };

  /** 提交一个动作 → 用返回的整份清单重渲染 */
  const act = async (action: Record<string, unknown>, okText = ''): Promise<void> => {
    try {
      const doc = await requestJson<TodoDocumentResponse>(actionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (Array.isArray(doc.todos)) todos = doc.todos;
      editingId = null;
      setStatus(okText, okText ? 'ok' : '');
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const load = async (): Promise<void> => {
    try {
      const doc = await requestJson<TodoDocumentResponse>(baseUrl);
      todos = Array.isArray(doc.todos) ? doc.todos : [];
      setStatus('改动会立即保存到 todos.json（与番茄钟共用同一份关联任务）');
      render();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  /**
   * 拉这一屏的标注（农历/节气/调休）。接口不在也必须**照常工作**：
   * 失败就当作"没有标注"，日历本体与待办功能完全不受影响（优雅降级）。
   */
  const loadAnnotations = async (): Promise<void> => {
    try {
      const out = await requestJson<{ ok?: boolean; days?: Record<DateKey, TodoDayAnnotation> }>(
        `${baseUrl.replace(/\/$/, '')}/calendar?month=${month}`,
      );
      annotations = out && typeof out.days === 'object' && out.days ? out.days : {};
    } catch {
      annotations = {};
    }
    render();
  };

  /** 手动刷新节假日（休/班）数据：绕过缓存 TTL 重取，失败也只是没有角标 */
  const refreshHolidays = async (): Promise<void> => {
    setStatus('正在重新拉取节假日数据…');
    try {
      const out = await requestJson<{ ok?: boolean; days?: Record<DateKey, TodoDayAnnotation> }>(
        `${baseUrl.replace(/\/$/, '')}/calendar/refresh?month=${month}`,
        { method: 'POST' },
      );
      annotations = out && typeof out.days === 'object' && out.days ? out.days : {};
      setStatus('节假日数据已刷新', 'ok');
    } catch (error) {
      setStatus(
        `节假日数据刷新失败（只是没有休/班角标）：${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
    render();
  };

  /** 一行待办 */
  const renderItem = (todo: TodoItem, host: HTMLElement): void => {
    const li = node('li', 'dshtd-item');
    li.dataset.completed = String(todo.completed);
    if (editingId === todo.id) {
      const edit = node('div', 'dshtd-edit');
      const titleInput = node('input');
      titleInput.value = todo.title;
      const notesInput = node('textarea');
      notesInput.value = todo.notes;
      notesInput.rows = 2;
      const dueInput = node('input');
      dueInput.type = 'date';
      dueInput.value = todo.dueDate ?? '';
      const schedInput = node('input');
      schedInput.type = 'date';
      schedInput.value = todo.scheduledDate ?? '';
      const row = node('div', 'row');
      const dueLabel = node('label');
      dueLabel.append('截止', dueInput);
      const schedLabel = node('label');
      schedLabel.append('计划', schedInput);
      row.append(dueLabel, schedLabel);
      const actions = node('div', 'row');
      const save = button('保存', 'dshtd-icon');
      const cancel = button('取消', 'dshtd-icon');
      const del = button('删除', 'dshtd-icon');
      actions.append(save, cancel, del);
      edit.append(titleInput, notesInput, row, actions);
      // 文本字段与日期字段是两个动作（宿主侧各自校验）：先 update 再 reschedule，
      // 两个都成功才算保存成功——否则"改了标题但日期没生效"会静默骗人。
      save.onclick = () => {
        void (async () => {
          await act({ type: 'update', id: todo.id, patch: { title: titleInput.value, notes: notesInput.value } });
          await act(
            {
              type: 'reschedule',
              id: todo.id,
              patch: { dueDate: dueInput.value || null, scheduledDate: schedInput.value || null },
            },
            '已保存',
          );
        })();
      };
      cancel.onclick = () => {
        editingId = null;
        render();
      };
      del.onclick = () => void act({ type: 'delete', id: todo.id }, '已删除');
      li.append(edit);
      host.append(li);
      return;
    }

    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.completed;
    checkbox.onchange = () => void act({ type: 'complete', id: todo.id, completed: checkbox.checked });
    const main = node('div', 'dshtd-item-main');
    const titleEl = node('div', 'dshtd-item-title', todo.title);
    const meta = node('div', 'dshtd-item-meta');
    const today = todayKey();
    if (todo.dueDate) {
      const overdue = !todo.completed && todo.dueDate < today;
      const chip = node('span', overdue ? 'is-over' : 'is-due', `截止 ${todo.dueDate}${overdue ? '（逾期）' : ''}`);
      meta.append(chip);
    }
    if (todo.scheduledDate) meta.append(node('span', undefined, `计划 ${todo.scheduledDate}`));
    if (todo.estimatedPomodoros > 0 || todo.completedPomodoros > 0) {
      meta.append(node('span', undefined, `🍅 ${todo.completedPomodoros}/${todo.estimatedPomodoros}`));
    }
    main.append(titleEl, meta);
    const actions = node('div', 'dshtd-item-actions');
    const editBtn = button('编辑');
    editBtn.onclick = () => {
      editingId = todo.id;
      render();
    };
    const delBtn = button('删除');
    delBtn.onclick = () => void act({ type: 'delete', id: todo.id }, '已删除');
    actions.append(editBtn, delBtn);
    li.append(checkbox, main, actions);
    // 拖拽改期：拖到任意日期格子上 → reschedule（只在当前视图的字段上改）
    li.draggable = true;
    li.addEventListener('dragstart', (event) => {
      li.dataset.dragging = 'true';
      event.dataTransfer?.setData('text/plain', todo.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      delete li.dataset.dragging;
    });
    host.append(li);
  };

  /** 一个列表块（当天 / 逾期 / 收集箱） */
  const renderList = (titleText: string, note: string, list: TodoItem[], emptyText: string): HTMLElement => {
    const panel = node('div', 'dshtd-panel');
    const head2 = node('div', 'dshtd-panel-head');
    head2.append(node('span', 'dshtd-panel-title', titleText));
    if (note) head2.append(node('span', 'dshtd-panel-note', note));
    const ul = node('ul', 'dshtd-list');
    if (list.length === 0) {
      const empty = node('div', 'dshtd-empty', emptyText);
      panel.append(head2, empty);
      return panel;
    }
    for (const todo of list) renderItem(todo, ul);
    panel.append(head2, ul);
    return panel;
  };

  /** 整块重渲染（数据量小，简单可靠优先） */
  const render = (): void => {
    content.replaceChildren();
    const today = todayKey();
    const digest = todoDigest(todos, today, field);
    const counts = todoCountsByDate(todos, field);
    // 逾期日集合（只算一次，别在 42 个格子里各过滤一遍整份清单）：
    // 只按截止日期算逾期——"我打算昨天做"不算欠债
    const overdueDays = new Set<DateKey>();
    for (const todo of todos) {
      if (field !== 'due' || todo.completed || !todo.dueDate) continue;
      if (todo.dueDate < today) overdueDays.add(todo.dueDate);
    }

    // ---- 工具栏 ----
    const toolbar = node('div', 'dshtd-toolbar');
    const prev = button('‹');
    prev.title = '上个月';
    prev.onclick = () => {
      month = shiftMonth(month, -1);
      void loadAnnotations();
    };
    const next = button('›');
    next.title = '下个月';
    next.onclick = () => {
      month = shiftMonth(month, 1);
      void loadAnnotations();
    };
    const todayBtn = button('今天');
    todayBtn.onclick = () => {
      selected = todayKey();
      month = monthKeyOf(selected);
      render();
      void loadAnnotations();
    };
    const fieldBtn = button(field === 'due' ? '按截止日期' : '按计划日期');
    fieldBtn.title = '切换日历以哪个日期打点';
    fieldBtn.onclick = () => {
      field = field === 'due' ? 'scheduled' : 'due';
      render();
    };
    const refreshBtn = button('刷新节假日');
    refreshBtn.title = '重新拉取当年的法定节假日与调休（休/班）数据';
    refreshBtn.onclick = () => void refreshHolidays();
    toolbar.append(prev, next, todayBtn, node('span', 'dshtd-month', formatMonthTitle(month)), fieldBtn, refreshBtn);
    toolbar.append(node('span', 'dshtd-spacer'), status);
    content.append(toolbar);

    // ---- 汇总 chips ----
    const chips = node('div', 'dshtd-digest');
    const chip = (label: string, value: string, className = ''): HTMLElement => {
      const el = node('span', 'dshtd-chip' + (className ? ' ' + className : ''));
      el.append(label, node('b', undefined, value));
      return el;
    };
    chips.append(
      chip('今天未完成 ', String(digest.todayOpen)),
      chip('今天已完成 ', String(digest.todayDone)),
      chip('逾期 ', String(digest.overdue), digest.overdue > 0 ? 'is-overdue' : ''),
      chip('收集箱 ', String(digest.unscheduled), digest.unscheduled > 0 ? 'is-inbox' : ''),
      chip('全部 ', `${digest.done}/${digest.total}`),
    );
    content.append(chips);

    // ---- 主体：左月历 / 右侧列表 ----
    const body = node('div', 'dshtd-body');
    const calWrap = node('div', 'dshtd-cal');
    const weekdays = node('div', 'dshtd-weekdays');
    weekdays.append(node('span', 'dshtd-weekno', '周'));
    for (const name of ['一', '二', '三', '四', '五', '六', '日']) weekdays.append(node('span', undefined, name));
    calWrap.append(weekdays);

    for (const week of monthGrid(month, 1) as CalendarWeek[]) {
      const row = node('div', 'dshtd-week');
      row.append(node('span', 'dshtd-weekno', String(week.week)));
      for (const day of week.days) {
        const cell = node('div', 'dshtd-day');
        cell.dataset.out = String(!day.inMonth);
        cell.dataset.today = String(day.key === today);
        cell.dataset.selected = String(day.key === selected);
        cell.title = formatDateLabel(day.key);
        cell.append(node('span', 'dshtd-daynum', String(day.day)));
        const ann = annotations[day.key];
        if (ann?.term || ann?.lunar) {
          const text = ann.term ?? ann.lunar ?? '';
          const lunarEl = node('span', 'dshtd-daylunar' + (ann.term ? ' is-festival' : ''), text);
          cell.append(lunarEl);
        }
        if (ann?.dayType === 'off' || ann?.dayType === 'work') {
          const flag = node(
            'span',
            'dshtd-dayflag ' + (ann.dayType === 'off' ? 'is-off' : 'is-work'),
            ann.dayType === 'off' ? '休' : '班',
          );
          cell.append(flag);
        }
        const dots = node('div', 'dshtd-dots');
        const dayCount = counts[day.key];
        if (dayCount) {
          if (dayCount.open > 0) dots.append(node('span', 'dshtd-dot is-open'));
          if (dayCount.done > 0) dots.append(node('span', 'dshtd-dot is-done'));
          if (overdueDays.has(day.key)) dots.append(node('span', 'dshtd-dot is-over'));
          dots.append(node('span', 'dshtd-daycount', String(dayCount.open + dayCount.done)));
        }
        cell.append(dots);
        cell.onclick = () => {
          selected = day.key;
          if (!day.inMonth) month = monthKeyOf(day.key);
          render();
          if (!day.inMonth) void loadAnnotations();
        };
        // 拖拽改期：把待办拖进这一格
        cell.addEventListener('dragover', (event) => {
          event.preventDefault();
          cell.dataset.drop = 'true';
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        cell.addEventListener('dragleave', () => {
          delete cell.dataset.drop;
        });
        cell.addEventListener('drop', (event) => {
          event.preventDefault();
          delete cell.dataset.drop;
          const id = event.dataTransfer?.getData('text/plain') ?? '';
          if (!id) return;
          const patch = field === 'due' ? { dueDate: day.key } : { scheduledDate: day.key };
          void act({ type: 'reschedule', id, patch }, `已排到 ${day.key}`);
        });
        row.append(cell);
      }
      calWrap.append(row);
    }
    // 注意：这是 DOM 文本，不是 markdown —— 别在这里写 **强调**（会原样显示星号）
    const hint = node('p', 'dshtd-hint');
    hint.append('提示：把右侧的待办', node('b', undefined, '拖到某一天的格子上'), '即可改期；点格子切换当天清单。');
    calWrap.append(hint);

    const side = node('div', 'dshtd-side');
    // 新建（建到当前选中日期上）
    const newRow = node('div', 'dshtd-new');
    const newInput = node('input');
    newInput.placeholder = `新建到 ${selected}（回车）`;
    const addBtn = button('添加');
    const submitNew = (): void => {
      const text = newInput.value.trim();
      if (!text) return;
      newInput.value = '';
      const todo: Record<string, unknown> = { title: text };
      if (field === 'due') todo.dueDate = selected;
      else todo.scheduledDate = selected;
      void act({ type: 'create', todo }, '已添加');
    };
    addBtn.onclick = submitNew;
    newInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitNew();
    });
    newRow.append(newInput, addBtn);
    side.append(newRow);

    side.append(
      renderList(
        formatDateLabel(selected),
        `${todosOnDate(todos, selected, field).length} 条 · 按${field === 'due' ? '截止' : '计划'}`,
        todosOnDate(todos, selected, field),
        '这一天还没有安排',
      ),
    );
    const overdue = overdueTodos(todos, today);
    if (overdue.length > 0) side.append(renderList('逾期', `${overdue.length} 条`, overdue, ''));
    side.append(renderList('收集箱', '没有排期的', unscheduledTodos(todos), '收集箱是空的'));

    body.append(calWrap, side);
    content.append(body);
  };

  void load().then(() => void loadAnnotations());
  return { close };
}
