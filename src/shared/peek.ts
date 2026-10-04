/**
 * 窥屏吐槽（src/shared，浏览器 bundle 与桌面 shared-core 共用）：请求契约 + 一次窥屏的发起逻辑。
 *
 * 与碎碎念的区别：碎碎念是 GET（句子由 host 生成并缓存，多端轮询看到同一句）；
 * 窥屏的**情报必须由发起端提供**（只有桌面 helper 能问 Windows "前台是什么窗口"），
 * 所以走 POST：把情报带上去，host 生成一句回来。同一份情报多端共享没意义（各自看各自的屏幕），
 * 因此 host 侧只按周期做节流去重，不跨端复用结果。
 *
 * 展示仍复用碎碎念链路（showWhisper：说话动画 + 白色气泡 + 可选配图）。
 */

/** 情报：前台窗口（拿不到的字段省略） */
export interface PeekWindowContext {
  windowTitle?: string;
  processName?: string;
  idleSeconds?: number;
}

/** 屏幕截图（base64 JPEG；只有开启 peekScreenEnabled 且模型支持图片时才会真的发出去） */
export interface PeekShot {
  /** base64（不含 data: 前缀） */
  base64: string;
  mediaType?: string;
}

export type PeekState =
  | { ok: true; text: string; image?: string; ts: number; withImage?: boolean; imageDropped?: boolean }
  | { ok: false; reason: 'provider-missing' | 'generate-error' | 'disabled' | 'bad-request'; message?: string };

/** 窥屏要等模型看图+说话，超时放宽到 60s（与对话同级） */
const PEEK_TIMEOUT_MS = 60_000;

/**
 * 发起一次窥屏：POST {context, image} → 返回一句吐槽（+可选表情包配图名）。
 * 网络/解析失败显式抛错（调用方决定是静默跳过还是报错，绝不静默伪造文案）。
 * @param baseUrl 端点基址（桌面传绝对 URL：file:// 页面需要绝对地址）
 */
export async function sendPeek(
  baseUrl: string,
  petId: string,
  context: PeekWindowContext,
  image?: PeekShot | null,
): Promise<PeekState> {
  const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'pet=' + encodeURIComponent(petId);
  const body: Record<string, unknown> = { context };
  if (image && image.base64) body.image = { base64: image.base64, mediaType: image.mediaType || 'image/jpeg' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PEEK_TIMEOUT_MS),
  });
  const raw: unknown = await res.json().catch(() => null);
  if (!raw || typeof raw !== 'object') throw new Error('dsh-pet-desktop: 窥屏响应非法');
  const o = raw as Record<string, unknown>;
  if (o.ok !== true) {
    const reason =
      o.reason === 'provider-missing' || o.reason === 'generate-error' || o.reason === 'disabled'
        ? o.reason
        : 'bad-request';
    return { ok: false, reason, message: typeof o.message === 'string' ? o.message : undefined };
  }
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) throw new Error('dsh-pet-desktop: 窥屏文本非法');
  const image2 = typeof o.image === 'string' && o.image.trim() ? o.image.trim() : undefined;
  return {
    ok: true,
    text,
    ...(image2 ? { image: image2 } : {}),
    ts: Number(o.ts) || 0,
    ...(o.withImage === true ? { withImage: true } : {}),
    ...(o.imageDropped === true ? { imageDropped: true } : {}),
  };
}
