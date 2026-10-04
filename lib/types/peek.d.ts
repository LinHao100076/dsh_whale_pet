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
/** 模型模态标记（dsh-llm 的 ModelModality 取值） */
export declare const IMAGE_MODALITY = "image";
/**
 * 该不该把截图发给模型（纯函数）：
 *   'send' = 模型元数据显式声明支持图片输入；
 *   'skip' = 模型元数据**显式不含**图片（明确否定的能力），别浪费一次必然失败的请求；
 *   'try'  = 元数据缺失/未知 → 先试一次（调用方在失败时自动退回纯情报）。
 * 语义依据 dsh-llm 的 LlmModelInfo.inputModalities 注释："absent means unknown,
 * while an explicit omission is negative capability"。
 */
export declare function decideImageUse(inputModalities: readonly string[] | undefined | null): 'send' | 'skip' | 'try';
/**
 * 拼「主人的屏幕情报」段（纯函数）。
 * 窗口情报全空也要给一句话——模型据此知道"没看到"，而不是自己编一个场景。
 */
export declare function buildPeekIntel(intel: PeekIntel): string;
/**
 * 拼用户指令（纯函数）：态度规则按番茄钟阶段切换——这正是"和番茄钟联动"的落点。
 * hasImage=true 时额外说明带了截图（并要求只挑一点说，不要逐条描述画面）。
 */
export declare function buildPeekInstruction(hasImage: boolean): string;
/** 供 LLM 调用用的上下文最小形状（防御式：不依赖完整类型） */
interface PeekLlmCtx {
    agentDefaultModel: {
        currentSelection(): {
            provider: string;
            model: string;
        };
    };
    llm?: unknown;
    attachments?: unknown;
}
/** 截图（base64 JPEG） */
export interface PeekImage {
    base64: string;
    /** 目前只支持 image/jpeg（desktopCapturer 的 toJPEG） */
    mediaType?: string;
}
/**
 * 生成一句窥屏吐槽。
 * @param system 人设（peekPrompt + 名字声明，由调用方拼装）
 * @param intel 情报（窗口 + 番茄钟）
 * @param image 截图（可选）；带了图但生成失败时会自动去掉图重试一次
 */
export declare function generatePeek(ctx: PeekLlmCtx, system: string, intel: PeekIntel, image?: PeekImage | null): Promise<PeekGenerateResult | PeekFailure>;
export {};
