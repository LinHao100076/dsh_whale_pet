/** A compact modal surface shared by the browser overlay and Electron pet windows. */
import { DEFAULT_PHYSICS } from './physics';
import { clampSfxVolume, DEFAULT_SFX_FILE, isSoundFileName } from './sfx';
import type { PomodoroSettings } from './pomodoro';
import type { ProductivityAction, ProductivitySnapshot } from './productivity';
// 待办类型只用来展示「关联任务」候选（数据来自 /todo）；新建/编辑待办的动作已经不在这里用
import type { TodoItem } from './todo';
import type { PhysicsParams } from './types';

export interface ProductivityPanelOptions {
  onOpenChange?: (open: boolean) => void;
}

interface ConfigPet {
  id: string;
  name?: string;
  size: number;
  display: 'web' | 'desktop' | 'both' | 'none';
  balanceEnabled: boolean;
  whisperEnabled?: boolean;
  workStatusEnabled?: boolean;
  /** 窥屏吐槽开关（这只宠物是否偷看+吐槽） */
  peekEnabled?: boolean;
  position: { corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; marginX: number; marginY: number };
  [key: string]: unknown;
}

interface ConfigDocument {
  main?: ConfigMain;
  [key: string]: unknown;
}

/** 条目级（main）全局字段：所有桌宠共用；右键配置面板直接可编辑的就是这些 */
interface ConfigMain {
  pets?: ConfigPet[];
  notificationsEnabled?: boolean;
  whisperImageEnabled?: boolean;
  chatImageEnabled?: boolean;
  confineToScreen?: boolean;
  hideOnFullscreen?: boolean;
  /** 窥屏吐槽：人设（全局默认；种类文件顶层可覆盖）+ 截图/番茄钟开关 + 周期（eventsRefreshSec.peek） */
  peekPrompt?: string;
  peekScreenEnabled?: boolean;
  peekPomodoroEnabled?: boolean;
  /** 「需要你做决定」提醒音：开关 / 音量 / 文件名（用户把音频丢进 main-sound/ 后改这里） */
  sfxEnabled?: boolean;
  sfxVolume?: number;
  sfxDecision?: string;
  eventsRefreshSec?: Record<string, number>;
  physics?: Partial<PhysicsParams>;
  [key: string]: unknown;
}

/** 全局开关状态（面板内可变；保存时整包写入用户配置顶层） */
interface ConfigGlobals {
  notificationsEnabled: boolean;
  whisperImageEnabled: boolean;
  chatImageEnabled: boolean;
  confineToScreen: boolean;
  hideOnFullscreen: boolean;
  peekScreenEnabled: boolean;
  peekPomodoroEnabled: boolean;
  sfxEnabled: boolean;
}

/** 物理参数合法性：与宿主的 physicsValid 同一套规则（非法宿主会回 400，这里先就地红字） */
function physicsValid(p: PhysicsParams): boolean {
  return (
    Number.isFinite(p.gravity) &&
    p.gravity >= 0 &&
    Number.isFinite(p.restitution) &&
    p.restitution >= 0 &&
    p.restitution <= 1 &&
    Number.isFinite(p.groundFriction) &&
    p.groundFriction >= 0 &&
    Number.isFinite(p.throwPower) &&
    p.throwPower > 0
  );
}

const CSS = `
/* 「气泡框」外观（右键菜单 →「配置桌宠」/「番茄钟与 Todo」）：不再压暗全屏，
   整块面板就是浮在桌宠上方的一枚白色圆润气泡（底部小尾巴指向宠物），
   圆角/投影/字体与对话气泡（CHAT_CSS）同一套观感，只是尺寸更大。
   注意：card 不能 overflow:hidden（会把 ::after 尾巴裁掉），因此圆角由 head/content 各自收边。 */
.dshpd-backdrop{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:26px;box-sizing:border-box;background:transparent;pointer-events:auto;font:14px/1.6 'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif;color:#2b2b2b}
.dshpd-backdrop *{box-sizing:border-box}
.dshpd-card{position:relative;width:min(780px,100%);max-height:min(880px,94vh);display:flex;flex-direction:column;border-radius:24px;background:rgba(255,255,255,.97);box-shadow:0 18px 52px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.08)}
.dshpd-card::after{content:"";position:absolute;left:50%;bottom:-13px;transform:translateX(-50%);border:13px solid transparent;border-top-color:rgba(255,255,255,.97);border-bottom:none}
.dshpd-head{display:flex;align-items:center;gap:12px;padding:18px 22px 14px;border-radius:24px 24px 0 0;border-bottom:1px solid rgba(43,43,43,.07);background:rgba(246,248,252,.72)}
.dshpd-mark{width:38px;height:38px;display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(145deg,#dbeafe,#ede9fe);font-size:19px}
.dshpd-heading{min-width:0;flex:1}.dshpd-title{margin:0;font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-.01em;color:#1f2a44}.dshpd-subtitle{margin:3px 0 0;color:#78849a;font-size:12px}
.dshpd-close{width:32px;height:32px;border:0;border-radius:10px;background:#f0f2f7;color:#68748a;font-size:19px;line-height:1;cursor:pointer}.dshpd-close:hover{background:#e4e8f0;color:#253149}
.dshpd-content{overflow:auto;padding:18px 22px 22px;border-radius:0 0 24px 24px;scrollbar-width:thin;scrollbar-color:#c8cfdb transparent}
.dshpd-status{min-height:20px;margin:0 0 12px;font-size:12px;color:#64748b}.dshpd-status[data-kind=ok]{color:#17804a}.dshpd-status[data-kind=error]{color:#c13e4b}
.dshpd-card button,.dshpd-card input,.dshpd-card textarea,.dshpd-card select{font:inherit}.dshpd-card button{border:0;cursor:pointer}
.dshpd-field{display:flex;flex-direction:column;gap:5px;min-width:0}.dshpd-field>span,.dshpd-field>label{font-size:12px;font-weight:650;color:#64718a}
.dshpd-field textarea{resize:vertical;line-height:1.55;font-family:inherit}
.dshpd-control{width:100%;min-height:36px;padding:8px 10px;border:1px solid #dce2ed;border-radius:10px;background:#fff;color:#27334b;outline:none}.dshpd-control:focus{border-color:#8b9dff;box-shadow:0 0 0 3px rgba(101,120,255,.13)}
.dshpd-check{display:flex;align-items:center;gap:9px;min-height:32px;color:#44516a;font-size:13px}.dshpd-check input{width:16px;height:16px;accent-color:#6679ef}
.dshpd-primary,.dshpd-secondary,.dshpd-danger,.dshpd-icon{min-height:34px;padding:8px 13px;border-radius:10px;font-weight:650;transition:transform .15s,background .15s}.dshpd-primary{background:#586de8;color:#fff;box-shadow:0 5px 13px rgba(88,109,232,.22)}.dshpd-primary:hover{background:#465cda;transform:translateY(-1px)}.dshpd-secondary{background:#edf0f6;color:#46536d}.dshpd-secondary:hover{background:#e1e6ef}.dshpd-danger{background:#fff0f1;color:#bd4652}.dshpd-danger:hover{background:#ffe2e4}.dshpd-icon{min-width:32px;padding:6px 9px;background:#f0f2f7;color:#65718a}
.dshpd-primary:disabled,.dshpd-secondary:disabled,.dshpd-danger:disabled{opacity:.55;cursor:wait;transform:none}
.dshpd-config-layout{display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px;min-height:340px}.dshpd-pet-sidebar{padding:10px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(246,248,252,.85)}.dshpd-pet-sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;font-size:13px;font-weight:700;color:#485570}.dshpd-pet-list{display:flex;flex-direction:column;gap:5px}.dshpd-pet-choice{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border-radius:10px;background:transparent;text-align:left;color:#4b5870;font-size:13px}.dshpd-pet-choice:hover{background:#edf0f8}.dshpd-pet-choice[data-active=true]{background:#e7ebff;color:#394fc5;font-weight:700}.dshpd-pet-dot{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:#fff;font-size:14px}.dshpd-pet-editor{display:flex;flex-direction:column;min-width:0}.dshpd-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dshpd-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 14px;padding:10px 12px;border:1px solid rgba(43,43,43,.08);border-radius:13px;background:#fff}.dshpd-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(43,43,43,.09)}.dshpd-button-row{display:flex;align-items:center;gap:8px}.dshpd-muted{color:#8590a3;font-size:12px}
/* 分组卡片（配置面板的信息分区：桌宠 / 全局开关 / 物理）与字段说明 */
.dshpd-block{margin-bottom:14px;padding:14px 16px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(249,250,253,.9)}.dshpd-block:last-of-type{margin-bottom:0}.dshpd-block-head{display:flex;align-items:baseline;gap:10px;margin:0 0 12px}.dshpd-block-title{margin:0;font-size:14px;font-weight:740;color:#313d57}.dshpd-block-note{margin-left:auto;font-size:11px;line-height:1.5;color:#98a1b2;text-align:right}.dshpd-block-body{display:flex;flex-direction:column;gap:12px}.dshpd-hint{margin:0;font-size:11px;line-height:1.5;color:#8a94a6}
.dshpd-toggle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}.dshpd-toggle{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px;color:#44516a;cursor:pointer}.dshpd-toggle>span:first-child{display:flex;align-items:center;gap:8px}.dshpd-toggle input{width:16px;height:16px;flex:none;accent-color:#6679ef}.dshpd-toggle-label{font-weight:600;color:#3c4864}.dshpd-toggle-hint{padding-left:24px;font-size:11px;line-height:1.5;color:#8a94a6}
.dshpd-timer{padding:20px;border:1px solid rgba(43,43,43,.09);border-radius:18px;background:radial-gradient(circle at 85% 0%,rgba(214,220,255,.62),transparent 42%),linear-gradient(135deg,#fff,#f4f6ff);text-align:center}.dshpd-phase{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#e9edff;color:#4e61cc;font-size:12px;font-weight:750}.dshpd-clock{margin:10px 0 4px;font-size:clamp(48px,10vw,72px);font-weight:760;line-height:1;letter-spacing:-.06em;font-variant-numeric:tabular-nums;color:#252f4b}.dshpd-timer-caption{min-height:20px;color:#7d879a;font-size:12px}.dshpd-timer-controls{display:flex;justify-content:center;gap:8px;margin-top:17px}.dshpd-timer-controls button{min-width:82px}.dshpd-task-picker{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:10px;max-width:480px;margin:17px auto 0;text-align:left}.dshpd-task-picker>span{font-size:12px;font-weight:650;color:#69758d}.dshpd-cycle{margin-top:12px;color:#79849a;font-size:12px}
.dshpd-section{margin-top:18px;padding:17px;border:1px solid rgba(43,43,43,.09);border-radius:16px;background:rgba(249,250,253,.9)}.dshpd-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 13px}.dshpd-section-title{margin:0;color:#313d57;font-size:15px;font-weight:740}.dshpd-todo-form{display:grid;grid-template-columns:minmax(0,1fr) 100px auto;gap:8px;margin-bottom:12px}.dshpd-todos{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}.dshpd-todo{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(43,43,43,.09);border-radius:12px;background:#fff}.dshpd-todo[data-dragging=true]{opacity:.48}.dshpd-todo[data-over=true]{border-color:#8594f4;background:#f5f6ff}.dshpd-todo>input[type=checkbox]{width:17px;height:17px;flex:none;accent-color:#6477e8}.dshpd-todo-main{flex:1;min-width:0}.dshpd-todo-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#35415a;font-weight:650}.dshpd-todo[data-completed=true] .dshpd-todo-title{text-decoration:line-through;color:#99a1af}.dshpd-todo-meta{margin-top:2px;color:#8892a5;font-size:11px}.dshpd-todo-actions{display:flex;gap:4px}.dshpd-todo-edit{display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:7px;width:100%}.dshpd-todo-edit textarea{grid-column:1/-1;min-height:52px;resize:vertical}.dshpd-todo-edit-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:6px}.dshpd-settings{margin-top:15px;border:1px solid rgba(43,43,43,.09);border-radius:14px;background:#fff}.dshpd-settings summary{padding:12px 15px;cursor:pointer;color:#4a5670;font-weight:700}.dshpd-settings-inner{display:flex;flex-direction:column;gap:13px;padding:0 15px 15px}.dshpd-settings-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dshpd-empty{padding:18px;border:1px dashed #d6dce7;border-radius:12px;text-align:center;color:#8791a4;font-size:13px}
@media(max-width:600px){.dshpd-backdrop{padding:10px}.dshpd-card{max-height:96vh;border-radius:18px}.dshpd-card::after{bottom:-11px;border-width:11px}.dshpd-head{padding:14px 15px;border-radius:18px 18px 0 0}.dshpd-content{padding:14px 15px 16px;border-radius:0 0 18px 18px}.dshpd-config-layout{grid-template-columns:1fr;gap:12px}.dshpd-pet-list{flex-direction:row;flex-wrap:wrap}.dshpd-form-grid{grid-template-columns:1fr 1fr}.dshpd-toggle-grid{grid-template-columns:1fr}.dshpd-todo-form{grid-template-columns:minmax(0,1fr) 80px}.dshpd-todo-form button{grid-column:1/-1}.dshpd-settings-grid{grid-template-columns:1fr 1fr}.dshpd-todo-actions .dshpd-icon{min-width:30px;padding:5px 7px}}
`;

export function formatPomodoroTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function productivityActionUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '').replace(/\/productivity$/, '/productivity/action');
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = node('label', 'dshpd-field');
  wrap.append(node('span', undefined, label), control);
  return wrap;
}

function input(type: string, value: string | number, min?: number, max?: number): HTMLInputElement {
  const control = node('input', 'dshpd-control');
  control.type = type;
  control.value = String(value);
  if (min !== undefined) control.min = String(min);
  if (max !== undefined) control.max = String(max);
  return control;
}

function select(options: Array<[string, string]>, value: string): HTMLSelectElement {
  const control = node('select', 'dshpd-control');
  for (const [optionValue, label] of options) {
    const option = node('option', undefined, label);
    option.value = optionValue;
    control.append(option);
  }
  control.value = value;
  return control;
}

function button(label: string, style = 'secondary'): HTMLButtonElement {
  return node('button', `dshpd-${style}`, label);
}

function checkbox(label: string, checked: boolean): HTMLLabelElement {
  const wrap = node('label', 'dshpd-check');
  const control = node('input');
  control.type = 'checkbox';
  control.checked = checked;
  wrap.append(control, document.createTextNode(label));
  return wrap;
}

/** 字段说明（一行小灰字，跟在控件下方；值语义/token 代价之类的解释写在这里） */
function hint(text: string): HTMLParagraphElement {
  return node('p', 'dshpd-hint', text);
}

/** 分组卡片：标题 + 右侧备注（如「全局，所有桌宠共用」）+ 内容体 */
function block(title: string, note = ''): { root: HTMLElement; body: HTMLElement } {
  const root = node('section', 'dshpd-block');
  const head = node('div', 'dshpd-block-head');
  head.append(node('h3', 'dshpd-block-title', title));
  if (note) head.append(node('span', 'dshpd-block-note', note));
  const body = node('div', 'dshpd-block-body');
  root.append(head, body);
  return { root, body };
}

/** 开关单元（勾选框 + 标题在上、说明在下；整格可点） */
function toggleCell(
  label: string,
  hintText: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLLabelElement {
  const wrap = node('label', 'dshpd-toggle');
  const top = node('span');
  const control = node('input');
  control.type = 'checkbox';
  control.checked = checked;
  control.onchange = () => onChange(control.checked);
  const text = node('span', 'dshpd-toggle-label', label);
  top.append(control, text);
  wrap.append(top, node('span', 'dshpd-toggle-hint', hintText));
  return wrap;
}

/** 数字字段（输入即写回调用方状态；说明跟在下面） */
function numberField(
  label: string,
  value: number,
  hintText: string,
  onInput: (value: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLLabelElement {
  const control = input('number', value, opts.min, opts.max);
  if (opts.step !== undefined) control.step = String(opts.step);
  control.oninput = () => onInput(Number(control.value));
  const wrap = field(label, control);
  wrap.append(hint(hintText));
  return wrap;
}

/** 下拉字段（说明跟在下面） */
function selectField(
  label: string,
  options: Array<[string, string]>,
  value: string,
  hintText: string,
  onChange: (value: string) => void,
): HTMLLabelElement {
  const control = select(options, value);
  control.onchange = () => onChange(control.value);
  const wrap = field(label, control);
  wrap.append(hint(hintText));
  return wrap;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

function setStatus(target: HTMLElement, message: string, kind: 'ok' | 'error' | '' = ''): void {
  target.textContent = message;
  target.dataset.kind = kind;
}

function configUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '').replace(/\/productivity$/, '/config');
}

export function mountProductivityPanel(
  baseUrl: string,
  mode: 'config' | 'productivity' = 'productivity',
  options: ProductivityPanelOptions = {},
): { close: () => void } {
  document.querySelector('[data-dshpd-panel="root"]')?.remove();
  document.querySelector('[data-dshpd-panel="style"]')?.remove();

  const style = node('style');
  style.dataset.dshpdPanel = 'style';
  style.textContent = CSS;
  document.head.append(style);

  const backdrop = node('div', 'dshpd-backdrop');
  backdrop.dataset.dshpdPanel = 'root';
  const card = node('section', 'dshpd-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'dshpd-title');
  const header = node('header', 'dshpd-head');
  const mark = node('div', 'dshpd-mark', mode === 'config' ? '🐟' : '🍅');
  mark.setAttribute('aria-hidden', 'true');
  const heading = node('div', 'dshpd-heading');
  const title = node('h2', 'dshpd-title', mode === 'config' ? '桌宠设置' : '番茄钟');
  title.id = 'dshpd-title';
  const subtitle = node(
    'p',
    'dshpd-subtitle',
    mode === 'config'
      ? '显示与位置 · 互动开关 · 窥屏人设 · 全局配图/通知 · 拖拽抛掷手感'
      : '专注计时 · 关联一条待办（清单在「待办日历」里）',
  );
  heading.append(title, subtitle);
  const closeButton = button('×', 'close');
  closeButton.setAttribute('aria-label', '关闭');
  header.append(mark, heading, closeButton);
  const content = node('main', 'dshpd-content');
  const status = node('p', 'dshpd-status');
  status.setAttribute('role', 'status');
  content.append(status);
  card.append(header, content);
  backdrop.append(card);
  document.body.append(backdrop);

  let isClosed = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    if (isClosed) return;
    isClosed = true;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    style.remove();
    options.onOpenChange?.(false);
  };
  closeButton.onclick = close;
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeyDown);
  options.onOpenChange?.(true);

  if (mode === 'config') void mountConfigEditor(content, status, baseUrl);
  else void mountProductivityEditor(content, status, baseUrl);

  return { close };
}

async function mountConfigEditor(content: HTMLElement, status: HTMLElement, baseUrl: string): Promise<void> {
  setStatus(status, '正在读取桌宠配置…');
  let config: ConfigDocument;
  try {
    config = await requestJson<ConfigDocument>(configUrl(baseUrl));
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    const retry = button('重新加载');
    retry.onclick = () => void mountConfigEditor(content, status, baseUrl);
    content.append(retry);
    return;
  }

  const main = config.main ?? {};
  let pets = Array.isArray(main.pets) ? main.pets.map((pet) => structuredClone(pet)) : [];
  if (!pets.length) {
    setStatus(status, '当前没有桌宠配置。');
    return;
  }
  let selectedId = pets[0].id;
  // 全局字段（成品 main 条目已按「内置默认 ← 用户层」填满，直接取用即可，不做兜底猜值）
  const globals: ConfigGlobals = {
    notificationsEnabled: main.notificationsEnabled !== false,
    whisperImageEnabled: main.whisperImageEnabled === true,
    chatImageEnabled: main.chatImageEnabled === true,
    confineToScreen: main.confineToScreen === true,
    hideOnFullscreen: main.hideOnFullscreen === true,
    peekScreenEnabled: main.peekScreenEnabled === true,
    peekPomodoroEnabled: main.peekPomodoroEnabled !== false,
    sfxEnabled: main.sfxEnabled !== false,
  };
  // 提醒音：音量与文件名（默认值来自 shared 常量，与宿主同一套规则）
  let sfxVolume = clampSfxVolume(main.sfxVolume);
  let sfxFile =
    typeof main.sfxDecision === 'string' && main.sfxDecision.trim() ? main.sfxDecision.trim() : DEFAULT_SFX_FILE;
  const physics: PhysicsParams = { ...DEFAULT_PHYSICS, ...(main.physics ?? {}) };
  // 窥屏人设与周期（顶层全局；种类文件可覆盖的是配置文件那条路，面板编辑的是 main 条目这一层）
  let peekPrompt = typeof main.peekPrompt === 'string' ? main.peekPrompt : '';
  let peekIntervalSec = Number(main.eventsRefreshSec?.peek) || 600;
  content.replaceChildren(status);

  const layout = node('div', 'dshpd-config-layout');
  const sidebar = node('aside', 'dshpd-pet-sidebar');
  const sidebarHead = node('div', 'dshpd-pet-sidebar-head');
  sidebarHead.append(node('span', undefined, '桌宠列表'));
  const addPet = button('+ 添加', 'icon');
  addPet.title = '以第一只桌宠为模板新增一只';
  sidebarHead.append(addPet);
  const petList = node('div', 'dshpd-pet-list');
  sidebar.append(sidebarHead, petList);
  const editor = node('div', 'dshpd-pet-editor');
  layout.append(sidebar, editor);
  content.append(layout);

  const renderEditor = () => {
    petList.replaceChildren();
    for (const item of pets) {
      const choice = button('', 'pet-choice');
      choice.dataset.active = String(item.id === selectedId);
      const icon = node('span', 'dshpd-pet-dot', '🐟');
      const label = node('span', undefined, item.name?.trim() || item.id);
      choice.append(icon, label);
      choice.onclick = () => {
        selectedId = item.id;
        renderEditor();
      };
      petList.append(choice);
    }

    const pet = pets.find((item) => item.id === selectedId) ?? pets[0];
    if (!pet) {
      editor.replaceChildren(node('div', 'dshpd-empty', '没有可编辑的桌宠'));
      return;
    }
    selectedId = pet.id;
    editor.replaceChildren();

    // ---- ① 这只桌宠：基础信息 / 显示与位置 / 互动功能 ----
    const petBlock = block('这只桌宠', `ID：${pet.id}`);
    const identityGrid = node('div', 'dshpd-form-grid');
    const name = input('text', pet.name ?? '');
    name.maxLength = 40;
    name.oninput = () => {
      pet.name = name.value;
    };
    const nameField = field('显示名称', name);
    nameField.append(hint('鼠标悬浮桌宠时的提示名，也会加进 AI 人设（你的名字是 X）。可重复；留空按 ID 处理。'));
    const sizeField = numberField(
      '桌宠大小（宽度 px）',
      pet.size,
      '高度自动 = 宽度 × 9/16；桌面与浏览器同一尺寸。',
      (value) => {
        pet.size = value;
      },
      { min: 80, max: 1200, step: 10 },
    );
    identityGrid.append(nameField, sizeField);

    const placeGrid = node('div', 'dshpd-form-grid');
    const displayField = selectField(
      '显示范围',
      [
        ['both', '浏览器与桌面'],
        ['web', '仅浏览器'],
        ['desktop', '仅桌面'],
        ['none', '暂不显示'],
      ],
      pet.display,
      '决定这只桌宠出现在浏览器 overlay / 桌面（透明小窗）哪一侧。',
      (value) => {
        pet.display = value as ConfigPet['display'];
        renderEditor();
      },
    );
    const cornerField = selectField(
      '初始位置',
      [
        ['top-left', '左上角'],
        ['top-right', '右上角'],
        ['bottom-left', '左下角'],
        ['bottom-right', '右下角'],
      ],
      pet.position.corner,
      '启动落点，也是右键菜单「回到初始位置」回到的角落。',
      (value) => {
        pet.position.corner = value as ConfigPet['position']['corner'];
      },
    );
    const marginXField = numberField(
      '水平偏移（px）',
      pet.position.marginX,
      '距所选角落的水平距离，可为负数（负 = 更靠外）。',
      (value) => {
        pet.position.marginX = value;
      },
    );
    const marginYField = numberField(
      '垂直偏移（px）',
      pet.position.marginY,
      '距所选角落的垂直距离，可为负数。',
      (value) => {
        pet.position.marginY = value;
      },
    );
    placeGrid.append(displayField, cornerField, marginXField, marginYField);

    const toggles = node('div', 'dshpd-toggle-grid');
    toggles.append(
      toggleCell(
        '余额互动',
        '触发余额动画并显示余额气泡（需服务商凭证，未配置时气泡内显式报错）。',
        pet.balanceEnabled === true,
        (value) => {
          pet.balanceEnabled = value;
        },
      ),
      toggleCell(
        '碎碎念',
        '按周期用 AI 生成一句话并播碎碎念动画（每次生成都会调用当前模型）。',
        pet.whisperEnabled !== false,
        (value) => {
          pet.whisperEnabled = value;
        },
      ),
      toggleCell(
        '工作状态联动',
        '跟随 DSH 思考/工作中/等待确认/完成/出错切对应动画并弹气泡（仅监听事件，不调用模型）。',
        pet.workStatusEnabled !== false,
        (value) => {
          pet.workStatusEnabled = value;
        },
      ),
      toggleCell(
        '窥屏吐槽',
        '按「窥屏周期」偷看一眼前台窗口（可选截图），让模型吐槽一句（每次都会调用模型）。仅桌面模式。',
        pet.peekEnabled === true,
        (value) => {
          pet.peekEnabled = value;
        },
      ),
    );
    petBlock.body.append(identityGrid, placeGrid, toggles);

    // ---- ② 全局开关（所有桌宠共用，写用户配置顶层） ----
    const globalBlock = block('全局开关', '所有桌宠共用 · 保存后生效');
    const globalGrid = node('div', 'dshpd-toggle-grid');
    globalGrid.append(
      toggleCell(
        '系统通知',
        '对话完成 / 生成失败 / 权限申请在窗口失焦时弹系统级通知（桌面右下角）。',
        globals.notificationsEnabled,
        (value) => {
          globals.notificationsEnabled = value;
        },
      ),
      toggleCell(
        '碎碎念配图',
        '碎碎念时从表情包池随机抽一张配图；只把这一张的名称+描述带进同一次请求（约 60 token）。',
        globals.whisperImageEnabled,
        (value) => {
          globals.whisperImageEnabled = value;
        },
      ),
      toggleCell(
        '对话配图',
        '由模型按当前语境从表情包池挑一张配图；每条消息都会附上整张清单（约 650 token 起）。',
        globals.chatImageEnabled,
        (value) => {
          globals.chatImageEnabled = value;
        },
      ),
      toggleCell(
        '抛掷锁定当前屏幕',
        '多屏时甩出去的桌宠只在松手那块屏幕内弹（屏缝当墙）；关掉则照常跨屏飞行。仅桌面模式。',
        globals.confineToScreen,
        (value) => {
          globals.confineToScreen = value;
        },
      ),
      toggleCell(
        '全屏时隐藏桌宠',
        '检测到别的应用全屏（游戏 / 全屏视频 / 演示模式）时，自动隐藏被全屏覆盖那块屏上的桌宠，结束后自动恢复；多屏时另一块屏的桌宠照常活动。仅桌面模式（浏览器端只看 Fullscreen API）。注意：隐藏后右键点不到桌宠，要改这个开关请去 DSH 设置页。',
        globals.hideOnFullscreen,
        (value) => {
          globals.hideOnFullscreen = value;
        },
      ),
      toggleCell(
        '窥屏：允许截图',
        '除窗口标题外再抓一张屏幕截图交给模型——需要多模态模型（当前模型不支持时自动退回只看窗口标题）。注意截图会随请求发给模型服务商。',
        globals.peekScreenEnabled,
        (value) => {
          globals.peekScreenEnabled = value;
        },
      ),
      toggleCell(
        '窥屏：联动番茄钟',
        '把番茄钟阶段/剩余时间/关联任务写进情报：专注阶段换成督促语气、发现摸鱼直接点名，休息阶段改为放松调侃。',
        globals.peekPomodoroEnabled,
        (value) => {
          globals.peekPomodoroEnabled = value;
        },
      ),
      toggleCell(
        '决定提醒音',
        'DSH 需要你拍板时（权限申请 / 模型提问 / 回合阻塞）播一段音频提醒。音频文件名与音量在下面那组里改。',
        globals.sfxEnabled,
        (value) => {
          globals.sfxEnabled = value;
        },
      ),
    );
    globalBlock.body.append(globalGrid);

    // ---- ③ 窥屏吐槽：人设 + 周期（全局；开关在上面的「全局开关」里，按宠物开关在「这只桌宠」里） ----
    const peekBlock = block('窥屏吐槽人设', '全局 · 保存后生效');
    const peekArea = node('textarea', 'dshpd-control');
    peekArea.value = peekPrompt;
    peekArea.rows = 3;
    peekArea.maxLength = 2000;
    peekArea.placeholder = '例如：你是主人桌面上的Q版蓝发小女仆，会偷偷瞄一眼屏幕然后小小地吐槽一句……';
    peekArea.oninput = () => {
      peekPrompt = peekArea.value;
    };
    const peekField = field('窥屏人设（提示词）', peekArea);
    peekField.append(
      hint(
        '只写"你是谁、怎么说话"；态度规则（专注督促 / 休息放松 / 摸鱼点名）由程序按番茄钟阶段自动追加。留空 = 用内置默认人设。',
      ),
    );
    const peekGrid = node('div', 'dshpd-form-grid');
    peekGrid.append(
      numberField(
        '窥屏周期（秒）',
        peekIntervalSec,
        '每这么久偷看一次并生成一句吐槽（每次都会调用一次模型，建议 ≥ 300 秒）。',
        (value) => {
          peekIntervalSec = value;
        },
        { min: 30, step: 30 },
      ),
    );
    peekBlock.body.append(peekField, peekGrid);

    // ---- ④ 决定提醒音：音量 + 文件名（开关在上面的「全局开关」里） ----
    const sfxBlock = block('决定提醒音', '全局 · 保存后生效');
    const sfxGrid = node('div', 'dshpd-form-grid');
    sfxGrid.append(
      numberField(
        '音量（0~1）',
        sfxVolume,
        '0 = 静音，1 = 满音量；非法值按 0.8 处理。',
        (value) => {
          sfxVolume = value;
        },
        { min: 0, max: 1, step: 0.1 },
      ),
    );
    const sfxName = input('text', sfxFile);
    sfxName.maxLength = 128;
    sfxName.placeholder = DEFAULT_SFX_FILE;
    sfxName.oninput = () => {
      sfxFile = sfxName.value.trim();
    };
    const sfxNameField = field('音频文件名', sfxName);
    sfxNameField.append(
      hint(
        '把音频放到 ~/.dsh/dsh-pet-desktop/main-sound/（用户目录，优先）或包内 assets/sound/，' +
          '再在这里填文件名（中文名也行）。支持 mp3 / wav / ogg / m4a / aac / opus / flac / webm；' +
          '文件不存在时完全安静，不会报错也不会播别的。',
      ),
    );
    sfxBlock.body.append(sfxNameField, sfxGrid);

    // ---- ⑤ 拖拽抛掷手感（物理参数，全局） ----
    const physicsBlock = block('拖拽抛掷手感', '全局 · 保存后桌面端自动重载生效');
    const physicsGrid = node('div', 'dshpd-form-grid');
    physicsGrid.append(
      numberField(
        '重力 gravity',
        physics.gravity,
        'px/s²，越大落得越快；0 = 无重力（抛出去匀速直飞）。',
        (value) => {
          physics.gravity = value;
        },
        { min: 0, step: 50 },
      ),
      numberField(
        '弹性 restitution',
        physics.restitution,
        '0~1，碰壁/落地保留的速度比例（1 = 完全弹性，0 = 撞上即停）。',
        (value) => {
          physics.restitution = value;
        },
        { min: 0, max: 1, step: 0.05 },
      ),
      numberField(
        '地面摩擦 groundFriction',
        physics.groundFriction,
        '/s，落地后水平速度衰减率；0 = 冰面不减速。',
        (value) => {
          physics.groundFriction = value;
        },
        { min: 0, step: 0.5 },
      ),
      numberField(
        '总力度 throwPower',
        physics.throwPower,
        '> 0，弹簧跟手与甩出初速的整体倍率（1 = 默认，越大越跟手、甩得越猛）。',
        (value) => {
          physics.throwPower = value;
        },
        { min: 0, step: 0.1 },
      ),
    );
    const physicsToggles = node('div', 'dshpd-toggle-grid');
    physicsToggles.append(
      toggleCell(
        '顶部反弹 ceilingBounce',
        '关掉后抛掷可飞出屏幕顶部（重力仍会把它拉回来）。',
        physics.ceilingBounce,
        (value) => {
          physics.ceilingBounce = value;
        },
      ),
      toggleCell(
        '宠物互撞 petCollision',
        '飞行中的桌宠撞到其它桌宠按动量守恒弹开（质量 ∝ 尺寸²）。',
        physics.petCollision,
        (value) => {
          physics.petCollision = value;
        },
      ),
    );
    const physicsActions = node('div', 'dshpd-button-row');
    const resetPhysics = button('恢复默认物理参数', 'secondary');
    resetPhysics.onclick = () => {
      Object.assign(physics, DEFAULT_PHYSICS);
      renderEditor();
      setStatus(status, '物理参数已恢复为默认值，点击「保存并应用」写入。');
    };
    physicsActions.append(resetPhysics);
    physicsBlock.body.append(physicsGrid, physicsToggles, physicsActions);

    // ---- ⑤ 底部：删除 / 保存 ----
    const footer = node('div', 'dshpd-footer');
    const footerNote = node('span', 'dshpd-muted', '改动只在点「保存并应用」后写入用户配置。');
    const footerButtons = node('div', 'dshpd-button-row');
    const removePet = button('删除桌宠', 'danger');
    removePet.disabled = pets.length < 2;
    removePet.title = pets.length < 2 ? '至少保留一只桌宠' : '';
    removePet.onclick = () => {
      if (pets.length < 2 || !window.confirm(`删除桌宠「${pet.name || pet.id}」？`)) return;
      pets = pets.filter((item) => item.id !== pet.id);
      selectedId = pets[0].id;
      renderEditor();
    };
    const save = button('保存并应用', 'primary');
    save.onclick = () => void saveConfig();
    footerButtons.append(removePet, save);
    footer.append(footerNote, footerButtons);

    editor.append(petBlock.root, globalBlock.root, peekBlock.root, sfxBlock.root, physicsBlock.root, footer);
  };

  addPet.onclick = () => {
    const template = pets[0];
    const id = `pet-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    const pet: ConfigPet = {
      ...structuredClone(template),
      id,
      name: '新桌宠',
      size: template.size || 240,
      balanceEnabled: false,
      whisperEnabled: false,
      workStatusEnabled: false,
      display: 'both',
      position: { ...template.position },
    };
    pets.push(pet);
    selectedId = id;
    renderEditor();
  };

  const saveConfig = async () => {
    if (
      pets.some(
        (pet) =>
          !pet.id ||
          !Number.isFinite(pet.size) ||
          pet.size <= 0 ||
          !Number.isFinite(pet.position.marginX) ||
          !Number.isFinite(pet.position.marginY),
      )
    ) {
      setStatus(status, '请检查桌宠大小与位置数值。', 'error');
      return;
    }
    if (!physicsValid(physics)) {
      setStatus(status, '请检查物理参数：重力 / 地面摩擦 ≥ 0，弹性 0~1，总力度 > 0。', 'error');
      return;
    }
    if (!Number.isFinite(peekIntervalSec) || peekIntervalSec <= 0) {
      setStatus(status, '请检查窥屏周期：必须是大于 0 的秒数。', 'error');
      return;
    }
    if (!Number.isFinite(sfxVolume) || sfxVolume < 0 || sfxVolume > 1) {
      setStatus(status, '请检查提醒音音量：必须在 0~1 之间。', 'error');
      return;
    }
    if (!isSoundFileName(sfxFile)) {
      setStatus(
        status,
        '请检查提醒音文件名：只填文件名（不要带路径），扩展名需为 mp3/wav/ogg/m4a/aac/opus/flac/webm。',
        'error',
      );
      return;
    }
    setStatus(status, '正在保存…');
    try {
      // 整包提交：pets + 四个全局开关 + physics（宿主 saveUserConfig 的白名单字段；
      // 未提交的顶层字段由宿主从磁盘现有用户配置透传保留，不会丢用户手改的精调配置）。
      const merged = await requestJson<ConfigDocument>(configUrl(baseUrl), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pets,
          notificationsEnabled: globals.notificationsEnabled,
          whisperImageEnabled: globals.whisperImageEnabled,
          chatImageEnabled: globals.chatImageEnabled,
          confineToScreen: globals.confineToScreen,
          hideOnFullscreen: globals.hideOnFullscreen,
          // 窥屏：人设 + 两个开关 + 周期（周期写进 eventsRefreshSec —— 连原有的 balance/whisper 一起提交，
          // 它们在成品配置里已经是"用户层优先、缺省内置默认"的合并结果，原样写回不会丢用户值）
          peekPrompt,
          peekScreenEnabled: globals.peekScreenEnabled,
          peekPomodoroEnabled: globals.peekPomodoroEnabled,
          sfxEnabled: globals.sfxEnabled,
          sfxVolume,
          sfxDecision: sfxFile,
          eventsRefreshSec: { ...(main.eventsRefreshSec ?? {}), peek: peekIntervalSec },
          physics,
        }),
      });
      window.dispatchEvent(new CustomEvent('dsh-pet-desktop:config-saved', { detail: merged }));
      setStatus(status, '已保存，桌宠配置已应用（桌面端会自动重载宠物窗口）。', 'ok');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    }
  };

  setStatus(status, '左侧选桌宠，右侧分区编辑；改完点「保存并应用」。');
  renderEditor();
}

async function mountProductivityEditor(content: HTMLElement, status: HTMLElement, baseUrl: string): Promise<void> {
  content.replaceChildren(status);
  setStatus(status, '正在读取计时器与待办…');
  let snapshot: ProductivitySnapshot;
  try {
    snapshot = await requestJson<ProductivitySnapshot>(baseUrl);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    return;
  }

  const timer = node('section', 'dshpd-timer');
  const phase = node('div', 'dshpd-phase');
  const clock = node('div', 'dshpd-clock', '25:00');
  const caption = node('div', 'dshpd-timer-caption');
  const controls = node('div', 'dshpd-timer-controls');
  const primary = button('开始专注', 'primary');
  const skip = button('跳过');
  const reset = button('重置');
  controls.append(primary, skip, reset);
  const taskPicker = node('label', 'dshpd-task-picker');
  taskPicker.append(node('span', undefined, '专注任务'));
  const selectedTodo = node('select', 'dshpd-control');
  taskPicker.append(selectedTodo);
  const cycle = node('div', 'dshpd-cycle');
  timer.append(phase, clock, caption, controls, taskPicker, cycle);

  // 「待办清单」已独立成「待办日历」（独立存储 todos.json + 独立面板）。
  // 番茄钟这里只保留**关联任务**：一个只读下拉，选项来自待办存储（GET /todo），
  // 不再提供新建/编辑/删除/排序——那些都在待办日历面板里做。
  const todoSection = node('section', 'dshpd-section');
  const todoHead = node('div', 'dshpd-section-head');
  const todoHeader = node('h3', 'dshpd-section-title', '关联任务');
  const todoCount = node('span', 'dshpd-muted');
  todoHead.append(todoHeader, todoCount);
  const todoHint = node(
    'p',
    'dshpd-muted',
    '待办清单已独立为「待办日历」（右键菜单打开）：这里有截止/计划日期、月历与收集箱。番茄钟只引用其中一条任务。',
  );
  todoSection.append(todoHead, todoHint);

  const settings = node('details', 'dshpd-settings');
  const summary = node('summary', undefined, '番茄钟设置');
  const settingsInner = node('div', 'dshpd-settings-inner');
  const settingsGrid = node('div', 'dshpd-settings-grid');
  const focusInput = input('number', snapshot.pomodoro.settings.focusMinutes, 1, 180);
  const shortInput = input('number', snapshot.pomodoro.settings.shortBreakMinutes, 1, 60);
  const longInput = input('number', snapshot.pomodoro.settings.longBreakMinutes, 1, 120);
  const intervalInput = input('number', snapshot.pomodoro.settings.longBreakEvery, 1, 12);
  settingsGrid.append(
    field('专注（分钟）', focusInput),
    field('短休息（分钟）', shortInput),
    field('长休息（分钟）', longInput),
    field('几轮后长休息', intervalInput),
  );
  const settingChecks = node('div', 'dshpd-check-grid');
  const bubbleToggle = checkbox('在桌宠显示计时状态', snapshot.pomodoro.settings.showBubble);
  const notificationToggle = checkbox('阶段结束时发送系统通知', snapshot.pomodoro.settings.notifications);
  settingChecks.append(bubbleToggle, notificationToggle);
  const settingsFooter = node('div', 'dshpd-footer');
  settingsFooter.append(node('span', 'dshpd-muted', '默认 25 / 5 / 15 分钟，每 4 轮长休息。'));
  const saveSettings = button('保存设置', 'secondary');
  settingsFooter.append(saveSettings);
  settingsInner.append(settingsGrid, settingChecks, settingsFooter);
  settings.append(summary, settingsInner);
  content.append(timer, todoSection, settings);

  let busy = false;
  /** 关联任务候选：来自**待办存储**（GET /todo），不再是快照里的遗留 todos */
  let linkedTodos: TodoItem[] = [];
  const todoEndpoint = `${baseUrl.replace(/\/productivity\/?$/, '')}/todo`;
  const currentRemaining = () => {
    const state = snapshot.pomodoro.state;
    return state.running && state.endsAt !== null
      ? Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000))
      : state.remainingSeconds;
  };

  const notifyPhaseChange = (previous: ProductivitySnapshot, next: ProductivitySnapshot) => {
    if (previous.pomodoro.state.sequence === next.pomodoro.state.sequence || !next.pomodoro.settings.notifications)
      return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const label =
      next.pomodoro.state.phase === 'focus'
        ? '专注时间'
        : next.pomodoro.state.phase === 'shortBreak'
          ? '短休息'
          : '长休息';
    try {
      new Notification(`番茄钟：${label}开始`, { body: '上一阶段已经结束。' });
    } catch {
      /* Browser notification API may be unavailable in embedded surfaces. */
    }
  };

  const render = () => {
    const state = snapshot.pomodoro.state;
    const names = { focus: '专注中', shortBreak: '短休息', longBreak: '长休息' };
    phase.textContent = `${state.phase === 'focus' ? '●' : '☕'} ${names[state.phase]}`;
    clock.textContent = formatPomodoroTime(currentRemaining());
    const linked = state.todoId ? linkedTodos.find((todo) => todo.id === state.todoId) : undefined;
    caption.textContent = state.todoId
      ? `当前任务：${linked?.title ?? '（已删除或不在待办日历里）'}`
      : '不关联任务也可以独立计时';
    primary.textContent = state.running
      ? '暂停'
      : state.remainingSeconds <
          (state.phase === 'focus'
            ? snapshot.pomodoro.settings.focusMinutes
            : state.phase === 'shortBreak'
              ? snapshot.pomodoro.settings.shortBreakMinutes
              : snapshot.pomodoro.settings.longBreakMinutes) *
            60
        ? '继续'
        : '开始';
    primary.disabled = busy;
    skip.disabled = busy;
    reset.disabled = busy;
    cycle.textContent = `已完成 ${state.completedFocusCycles} 个专注周期${snapshot.pomodoro.settings.showBubble ? ' · 桌宠状态气泡已开启' : ''}`;
    selectedTodo.replaceChildren();
    const noTask = node('option', undefined, '不关联任务');
    noTask.value = '';
    selectedTodo.append(noTask);
    for (const todo of linkedTodos.filter((item) => !item.completed)) {
      const option = node('option', undefined, todo.title);
      option.value = todo.id;
      selectedTodo.append(option);
    }
    // 当前关联的任务可能已完成/已删除：仍列出来，否则下拉会显示成"不关联任务"（骗人）
    const current = state.todoId ? linkedTodos.find((item) => item.id === state.todoId) : undefined;
    if (current && current.completed) {
      const option = node('option', undefined, `${current.title}（已完成）`);
      option.value = current.id;
      selectedTodo.append(option);
    }
    if (state.todoId && !current) {
      const option = node('option', undefined, '已删除的任务');
      option.value = state.todoId;
      selectedTodo.append(option);
    }
    selectedTodo.value = state.todoId ?? '';
    selectedTodo.disabled = busy || state.phase !== 'focus';
    const openCount = linkedTodos.filter((todo) => !todo.completed).length;
    todoCount.textContent = linkedTodos.length
      ? `${openCount} 项未完成 · 共 ${linkedTodos.length} 项`
      : '待办日历还是空的';
    for (const [control, value] of [
      [focusInput, snapshot.pomodoro.settings.focusMinutes],
      [shortInput, snapshot.pomodoro.settings.shortBreakMinutes],
      [longInput, snapshot.pomodoro.settings.longBreakMinutes],
      [intervalInput, snapshot.pomodoro.settings.longBreakEvery],
    ] as Array<[HTMLInputElement, number]>) {
      if (document.activeElement !== control) control.value = String(value);
    }
    (bubbleToggle.querySelector('input') as HTMLInputElement).checked = snapshot.pomodoro.settings.showBubble;
    (notificationToggle.querySelector('input') as HTMLInputElement).checked = snapshot.pomodoro.settings.notifications;
  };

  const runAction = async (action: ProductivityAction, successText = '已保存'): Promise<boolean> => {
    if (busy) return false;
    busy = true;
    setStatus(status, '正在保存…');
    try {
      const next = await requestJson<ProductivitySnapshot>(productivityActionUrl(baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      const previous = snapshot;
      snapshot = next;
      notifyPhaseChange(previous, next);
      busy = false;
      render();
      setStatus(status, successText, 'ok');
      return true;
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
      return false;
    } finally {
      busy = false;
    }
  };

  selectedTodo.onchange = () =>
    void runAction({ type: 'selectTodo', todoId: selectedTodo.value || null }, '专注任务已更新');
  primary.onclick = () =>
    void runAction(
      snapshot.pomodoro.state.running
        ? { type: 'pause' }
        : snapshot.pomodoro.state.remainingSeconds < snapshot.pomodoro.settings.focusMinutes * 60 &&
            snapshot.pomodoro.state.phase === 'focus'
          ? { type: 'resume' }
          : snapshot.pomodoro.state.remainingSeconds <
                (snapshot.pomodoro.state.phase === 'shortBreak'
                  ? snapshot.pomodoro.settings.shortBreakMinutes
                  : snapshot.pomodoro.settings.longBreakMinutes) *
                  60 && snapshot.pomodoro.state.phase !== 'focus'
            ? { type: 'resume' }
            : { type: 'start' },
      snapshot.pomodoro.state.running ? '计时已暂停' : '计时已开始',
    );
  skip.onclick = () => void runAction({ type: 'skip' }, '已切换到下一阶段');
  reset.onclick = () => void runAction({ type: 'reset' }, '计时已重置');
  saveSettings.onclick = () => {
    const nextSettings: PomodoroSettings = {
      focusMinutes: Number(focusInput.value),
      shortBreakMinutes: Number(shortInput.value),
      longBreakMinutes: Number(longInput.value),
      longBreakEvery: Number(intervalInput.value),
      showBubble: (bubbleToggle.querySelector('input') as HTMLInputElement).checked,
      notifications: (notificationToggle.querySelector('input') as HTMLInputElement).checked,
    };
    void runAction({ type: 'settings.update', settings: nextSettings }, '番茄钟设置已保存');
  };
  (notificationToggle.querySelector('input') as HTMLInputElement).onchange = async (event) => {
    if (
      !(event.target as HTMLInputElement).checked ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'default'
    )
      return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') setStatus(status, '系统通知权限未开启；阶段提醒仍会显示在面板中。');
    } catch {
      setStatus(status, '当前运行环境不支持系统通知。');
    }
  };

  /** 关联任务候选来自待办存储（失败就当作"没有待办"：番茄钟仍可独立计时，不阻塞任何操作） */
  const loadLinkedTodos = async (): Promise<void> => {
    try {
      const doc = await requestJson<{ todos?: TodoItem[] }>(todoEndpoint);
      linkedTodos = Array.isArray(doc.todos) ? doc.todos : [];
    } catch {
      linkedTodos = [];
    }
    render();
  };

  const poll = async () => {
    if (busy) return;
    try {
      const next = await requestJson<ProductivitySnapshot>(baseUrl);
      const previous = snapshot;
      const changed = JSON.stringify(previous) !== JSON.stringify(next);
      snapshot = next;
      notifyPhaseChange(previous, next);
      if (changed) render();
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : String(error), 'error');
    }
  };
  render();
  void loadLinkedTodos();
  setStatus(status, '计时保存在本机并与桌面/浏览器共享；待办清单在「待办日历」里。');
  const displayTimer = window.setInterval(() => {
    clock.textContent = formatPomodoroTime(currentRemaining());
  }, 250);
  const pollTimer = window.setInterval(() => void poll(), 2_000);
  const closeObserver = new MutationObserver(() => {
    if (!content.isConnected) {
      window.clearInterval(displayTimer);
      window.clearInterval(pollTimer);
      closeObserver.disconnect();
    }
  });
  closeObserver.observe(document.body, { childList: true, subtree: true });
}
