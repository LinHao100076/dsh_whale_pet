/**
 * 「需要你做决定」提醒音（客户端共用的纯逻辑，浏览器 bundle 与桌面 shared-core 同一份）。
 *
 * 场景：DSH 会话里出现**需要用户拍板**的事——权限申请（approval/asked）、
 * 模型用 ask_user_question 等你回答、回合被 blocked——桌宠就播一段提醒音（例如"在吗？在吗？"）。
 *
 * 为什么是"认领式"而不是各播各的：同一时刻可能有多个客户端在跑（桌面宠物窗口 N 个 + 浏览器
 * overlay 1 个），各播各的会变成合唱。所以宿主只记**一条全局待播提醒**，各端看到同一个 id 后去
 * `POST /sfx/claim` 认领——**先到先得**，只有拿到 play=true 的那个客户端才真的播。
 *
 * 本文件只有纯函数：轮询节奏、认领判定、音量夹取；播放本身在各自的薄壳里（桌面 sprite / 浏览器）。
 */
/** 一次待播提醒 */
export interface SfxPendingCue {
    id: string;
    ts: number;
}
/** 支持的音频扩展名 → Content-Type（浏览器/Electron 都能直接播的几种） */
export declare const SOUND_MIME: Record<string, string>;
/** 默认音频文件名（配置没写时找它） */
export declare const DEFAULT_SFX_FILE = "need-decision.mp3";
/** 默认音量 */
export declare const DEFAULT_SFX_VOLUME = 0.8;
/**
 * 文件名是否可用：配置里的名字会直接进 URL 与文件系统路径，所以只允许**单层文件名** +
 * 白名单扩展名（中文名允许；路径分隔符/控制字符/Windows 保留字符一律拒）。
 * 两端共用同一份规则：宿主用它兜底校验，UI 用它即时提示。
 */
export declare function isSoundFileName(name: unknown): boolean;
/** 音频文件的 MIME（未知扩展名 → 通用二进制流，播放端自行判断） */
export declare function soundMime(file: string): string;
/** GET /sfx 的响应体 */
export interface SfxState {
    ok: boolean;
    /** 开关（顶层 sfxEnabled）：关掉时客户端放慢轮询并绝不播放 */
    enabled: boolean;
    /** 0~1 */
    volume: number;
    /** 音频地址（宿主已解析：用户目录优先 → 包内 assets/sound）；文件缺失 → null */
    url: string | null;
    /** 待播提醒（null = 没有）；id 变化 = 新的一次"需要你决定" */
    pending: SfxPendingCue | null;
    /** 开关开着但音频文件找不到：客户端保持安静，控制台提示一次 */
    missing?: boolean;
}
/** 轮询间隔：开关开着 1s（跟手）；关掉放慢到 10s（不必每秒白问一次） */
export declare const SFX_POLL_MS = 1000;
export declare const SFX_POLL_IDLE_MS = 10000;
/** 这一拍之后隔多久再问：开关开着 1s，关掉 10s */
export declare function sfxPollDelayMs(enabled: boolean): number;
/**
 * 客户端这一拍该做什么：
 *   'none'  = 什么都不做（没开启 / 没有待播 / 这一条已经处理过 / 音频文件缺失）
 *   'claim' = 去认领这条提醒（POST /sfx/claim；play=true 才播）
 * 用"已处理过的 id"去重：同一个 id 只认领一次，避免每秒重复请求。
 */
export declare function sfxCueAction(lastHandledId: string, state: SfxState | null): 'none' | 'claim';
/** 音量夹取（0~1；非法/越界一律回落到合法区间，绝不让音量变成 NaN 而静音失败） */
export declare function clampSfxVolume(value: unknown, fallback?: number): number;
/**
 * 把宿主给的音频路径接到本端基址上。
 * 宿主返回的是**不带路由前缀**的 '/sound/<file>'；两端各自补前缀——与表情包图片同一约定：
 *   桌面：base = BASE（bridge scheme 或 http://127.0.0.1:port/dsh-pet-desktop-7340）
 *   浏览器：base = '/dsh-pet-desktop-7340'
 */
export declare function sfxAssetUrl(base: string, url: string | null | undefined): string | null;
