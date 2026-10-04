/**
 * 窥屏吐槽（host 半侧）：把「主人现在在干嘛」的情报交给模型，生成一句吐槽，走碎碎念同款气泡展示。
 *
 * 情报有两个来源：
 *   ① **前台窗口情报**（桌面 helper 用 Win32 取：窗口标题 / 进程名 / 空闲时长）——任何模型都能用，
 *      只上传几十个字符，不传画面；
 *   ② **可选屏幕截图**（helper 的 desktopCapturer 抓一张 JPEG）——需要多模态模型：
 *      dsh-llm 的模型元数据声明 inputModalities 含 image 才发；显式不含则跳过；
 *      未声明（未知）则**先试一次**，失败自动退回纯情报（用户体验优先，绝不因为图而整个失败）。
 *
 * 与碎碎念的分工：碎碎念是"随口一句"（无上下文），窥屏是"看见了什么才有话说"（有上下文）。
 * 两者共用同一份人设回落链（条目级 → main）与同一套展示路径（气泡 + 说话动画 + 可选配图）。
 *
 * 本文件只做：拼提示词（纯函数，可单测）+ 调 ctx.llm；缓存在调用方（index.ts 的 servePeek）。
 */

import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { supportsReasoningOff } from './llm-reasoning';

/** 前台窗口情报（helper 侧 Win32 查询结果；拿不到的字段省略） */
export interface PeekContext {
  /** 前台窗口标题（GetWindowTextW） */
  windowTitle?: string;
  /** 前台进程可执行文件名，不含路径（QueryFullProcessImageName） */
  processName?: string;
  /** 用户空闲时长（秒，GetLastInputInfo）：越久越可能"人在但没动" */
  idleSeconds?: number;
}

/** 番茄钟情报（宿主直接读 productivity 存储，与面板同一个事实来源） */
export interface PeekPomodoro {
  phase: 'focus' | 'shortBreak' | 'longBreak';
  running: boolean;
  remainingSeconds: number;
  /** 关联任务标题（state.todoId 命中的那条） */
  taskTitle?: string;
  /** 已完成专注周期数 */
  completedFocusCycles?: number;
}

/** 一次窥屏的全部输入 */
export interface PeekIntel {
  context: PeekContext;
  /** 番茄钟情报（peekPomodoroEnabled 关闭 / 读取失败时为 null） */
  pomodoro?: PeekPomodoro | null;
}

export interface PeekGenerateResult {
  ok: true;
  text: string;
  /** true = 这次带了截图 */
  withImage?: boolean;
  /** true = 本来带了截图但失败了，已自动退回纯情报重试 */
  imageDropped?: boolean;
}

export interface PeekFailure {
  ok: false;
  reason: 'provider-missing' | 'generate-error';
  message?: string;
}

/** 空闲多久才值得写进情报（秒）：刚动过就不提"没操作" */
const IDLE_MIN_SECONDS = 60;

/** 阶段中文名 */
const PHASE_LABELS: Record<string, string> = {
  focus: '专注中',
  shortBreak: '短休息',
  longBreak: '长休息',
};

/** 模型模态标记（dsh-llm 的 ModelModality 取值） */
export const IMAGE_MODALITY = 'image';

/**
 * 该不该把截图发给模型（纯函数）：
 *   'send' = 模型元数据显式声明支持图片输入；
 *   'skip' = 模型元数据**显式不含**图片（明确否定的能力），别浪费一次必然失败的请求；
 *   'try'  = 元数据缺失/未知 → 先试一次（调用方在失败时自动退回纯情报）。
 * 语义依据 dsh-llm 的 LlmModelInfo.inputModalities 注释："absent means unknown,
 * while an explicit omission is negative capability"。
 */
export function decideImageUse(inputModalities: readonly string[] | undefined | null): 'send' | 'skip' | 'try' {
  if (!Array.isArray(inputModalities) || inputModalities.length === 0) return 'try';
  return inputModalities.includes(IMAGE_MODALITY) ? 'send' : 'skip';
}

/** 剩余秒数 → "12 分钟" / "40 秒"（情报用，不追求精确） */
function humanizeSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return s + ' 秒';
  return Math.round(s / 60) + ' 分钟';
}

/**
 * 拼「主人的屏幕情报」段（纯函数）。
 * 窗口情报全空也要给一句话——模型据此知道"没看到"，而不是自己编一个场景。
 */
export function buildPeekIntel(intel: PeekIntel): string {
  const c = intel.context ?? {};
  const title = typeof c.windowTitle === 'string' ? c.windowTitle.trim() : '';
  const proc = typeof c.processName === 'string' ? c.processName.trim() : '';
  const lines: string[] = ['【你偷看到的情报】'];

  if (proc || title) {
    const app = proc ? proc : '（未知程序）';
    lines.push(title ? `- 前台程序：${app}；窗口标题：${title}` : `- 前台程序：${app}`);
  } else {
    lines.push('- 没看到前台窗口（可能是全屏应用、锁屏或刚切换）');
  }
  const idle = Number(c.idleSeconds);
  if (Number.isFinite(idle) && idle >= IDLE_MIN_SECONDS) {
    lines.push(`- 主人已经 ${humanizeSeconds(idle)}没有动键鼠了`);
  }

  const p = intel.pomodoro;
  if (p) {
    const label = PHASE_LABELS[p.phase] ?? p.phase;
    const parts = [`【番茄钟】${p.running ? label : label + '（已暂停）'}`];
    parts.push(`还剩 ${humanizeSeconds(p.remainingSeconds)}`);
    if (p.taskTitle) parts.push(`关联任务「${p.taskTitle}」`);
    if (Number.isFinite(Number(p.completedFocusCycles))) {
      parts.push(`本次会话已完成 ${Number(p.completedFocusCycles)} 个专注周期`);
    }
    lines.push(parts.join('，'));
  }
  return lines.join('\n');
}

/**
 * 拼用户指令（纯函数）：态度规则按番茄钟阶段切换——这正是"和番茄钟联动"的落点。
 * hasImage=true 时额外说明带了截图（并要求只挑一点说，不要逐条描述画面）。
 */
export function buildPeekInstruction(hasImage: boolean): string {
  const rules = [
    '请根据上面的情报，说一句 15~25 字的吐槽或点评，像偷偷瞄了一眼主人的屏幕那样自然。',
    '- 番茄钟在专注阶段：用督促、陪伴或俏皮的语气帮主人收心；如果情报显示他在看社交/视频/游戏类应用，直接点名吐槽他摸鱼。',
    '- 番茄钟在休息阶段：轻松调侃，让他好好休息，别催。',
    '- 没有番茄钟情报：就按你看到的内容随口点评一句。',
    '- 只说一句：不要罗列、不要复述窗口标题原文、不要解释你在偷看、不要提你是 AI。',
  ];
  if (hasImage) {
    rules.push('- 这次附了一张主人的屏幕截图，你能看到画面：只挑你最想吐槽的一点说，不要逐条描述画面内容。');
  }
  return rules.join('\n');
}

/** 供 LLM 调用用的上下文最小形状（防御式：不依赖完整类型） */
interface PeekLlmCtx {
  agentDefaultModel: { currentSelection(): { provider: string; model: string } };
  llm?: unknown;
  attachments?: unknown;
}

/** 截图（base64 JPEG） */
export interface PeekImage {
  base64: string;
  /** 目前只支持 image/jpeg（desktopCapturer 的 toJPEG） */
  mediaType?: string;
}

/** 单次生成超时（ms）：带截图时稍宽松（上传 + 视觉编码比纯文本慢） */
const TIMEOUT_MS = 45_000;

/** 图像附件服务的最小形状（ctx.attachments，可能不存在 → 纯情报降级） */
interface SaveImageCapable {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<unknown>;
}

/** 把截图登记成 durable 附件引用（失败/服务缺失 → null，调用方退回纯情报） */
async function savePeekImage(ctx: PeekLlmCtx, image: PeekImage): Promise<unknown | null> {
  const store = ctx.attachments as SaveImageCapable | undefined;
  if (!store || typeof store.saveImage !== 'function') return null;
  const data = Buffer.from(image.base64, 'base64');
  if (!data.length) return null;
  try {
    return await store.saveImage({ data, mediaType: image.mediaType || 'image/jpeg', name: 'peek.jpg' });
  } catch {
    return null; // 校验/落盘失败：不因为一张图让整次窥屏失败
  }
}

/**
 * 生成一句窥屏吐槽。
 * @param system 人设（peekPrompt + 名字声明，由调用方拼装）
 * @param intel 情报（窗口 + 番茄钟）
 * @param image 截图（可选）；带了图但生成失败时会自动去掉图重试一次
 */
export async function generatePeek(
  ctx: PeekLlmCtx,
  system: string,
  intel: PeekIntel,
  image?: PeekImage | null,
): Promise<PeekGenerateResult | PeekFailure> {
  let sel: { provider: string; model: string };
  try {
    sel = ctx.agentDefaultModel.currentSelection();
  } catch {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  if (!sel?.provider || !sel?.model) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }

  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const base = {
    provider: sel.provider,
    model: sel.model,
    system,
    temperature: 1,
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };

  const run = async (withImage: boolean): Promise<{ text: string } | { error: string }> => {
    const attachment = withImage && image ? await savePeekImage(ctx, image) : null;
    // 内容块用对象字面量拼（文本 + 可选图片附件）：图片块的形状由 dsh-llm / dsh-attachment 定义，
    // 但这里不引入它们的运行时类型，只在附件服务真实可用时才塞图片块——类型上显式断言一次。
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: buildPeekIntel(intel) + '\n\n' + buildPeekInstruction(!!attachment) },
    ];
    if (attachment) content.push({ type: 'image', attachment });
    const assembler = new BlockAssembler();
    try {
      for await (const chunk of llm.stream({
        ...base,
        messages: [createUserMessage({ content: content as never, source: { kind: 'user' } })],
      })) {
        assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const text = assembler
      .blocks()
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? (b as { text: string }).text : ''))
      .join('')
      .trim();
    if (!text) return { error: '模型未返回文本' };
    return { text };
  };

  const first = await run(!!image);
  if (!('error' in first))
    return image ? { ok: true, text: first.text, withImage: true } : { ok: true, text: first.text };

  // 带图失败 → 退回纯情报再试一次（把"图被服务商拒了"与"模型本身出错"区分开，
  // 后者第二次同样会失败，代价只是一次重试；前者能保住这次吐槽不白跑）
  if (image) {
    const second = await run(false);
    if (!('error' in second)) return { ok: true, text: second.text, imageDropped: true };
    return { ok: false, reason: 'generate-error', message: second.error };
  }
  return { ok: false, reason: 'generate-error', message: first.error };
}
