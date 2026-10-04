/**
 * 「需要你做决定」提醒音（宿主半侧）：音频文件解析 + 全局认领式提醒队列。
 *
 * 触发时机（三个事件都表示"模型在等你拍板"，全部来自 DSH 会话事件流）：
 *   - approval/asked           权限申请
 *   - tool/call ask_user_question   模型在等你回答选择题
 *   - turn/end block          回合被阻塞（等用户确认）
 *
 * 为什么要有队列而不是各客户端自己判断：多宠物窗口 + 浏览器 overlay 会同时在线，各播各的 = 合唱。
 * 宿主只记一条全局待播提醒，各端看到同一个 id 后 `POST /sfx/claim` 认领，先到先得，只有一个人播。
 *
 * 音频文件解析顺序（与动画素材同套路，用户产物优先、包内兜底）：
 *   ~/.dsh/dsh-pet-desktop/main-sound/<file>  →  <包>/assets/sound/<file>
 * 找不到就**安静地不播**（missing=true），绝不因为缺文件报错或改成播别的。
 */
import { type SfxPendingCue } from '../shared/sfx';
export { DEFAULT_SFX_FILE, SOUND_MIME, isSoundFileName, soundMime } from '../shared/sfx';
/** 提醒的存活时间（ms）：超过这么久没人认领就作废——
 *  你是"离开了一会儿回来"，不是"还要为五分钟前的事响一声" */
export declare const CUE_TTL_MS = 60000;
/** 两次提醒之间的最小间隔（ms）：连续多个权限申请别变成连响 */
export declare const CUE_MIN_GAP_MS = 3000;
/**
 * 解析音频文件的真实路径：用户目录（main-sound/）优先 → 包内 assets/sound/ 兜底。
 * @returns 存在的绝对路径；都不存在 → undefined
 */
export declare function resolveSoundFile(paths: {
    userRoot: string;
    packageRoot: string;
}, file: string): string | undefined;
/** 队列里的一条提醒 */
export interface SfxCue {
    id: string;
    ts: number;
}
/**
 * 全局提醒队列（进程内内存态，重启清空）：fire → 各端轮询看到 → 先认领者播 → 清空。
 * 纯逻辑、无 IO，可直接单测。
 */
export declare class CueStore {
    #private;
    constructor(options?: {
        minGapMs?: number;
        ttlMs?: number;
        now?: () => number;
    });
    /**
     * 报告一次"需要用户决定"。返回新提醒（被去抖挡掉时返回 null）。
     * 去抖只挡**极短时间内的连击**（同一批工具连续申请权限），不吞掉下一次真实决策。
     */
    fire(): SfxCue | null;
    /** 当前待播提醒（过期即清空并返回 null） */
    pending(): SfxPendingCue | null;
    /**
     * 认领：id 匹配且还没被认领 → true 并清空（"这一声响过了"）。
     * 不匹配/已被认领/已过期 → false（客户端据此保持安静）。
     */
    claim(id: unknown): boolean;
}
/** 组装 GET /sfx 的响应体（把配置、文件解析、队列三件事收在一处） */
export declare function sfxState(input: {
    enabled: boolean;
    volume: unknown;
    file: string;
    url: string | null;
    hasFile: boolean;
    pending: SfxPendingCue | null;
}): {
    ok: true;
    enabled: boolean;
    volume: number;
    url: string | null;
    pending: SfxPendingCue | null;
    missing?: boolean;
};
