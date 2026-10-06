// DSH peer 依赖类型补充：这些包由 DSH 宿主在运行时提供，本地开发无 node_modules，
// 这里为它们声明最小类型，便于 tsc 通过（运行时以 DSH 提供的为准）。
declare module '@deepseek-ai/dsh-home-paths' {
  /** 解析 DSH 主目录（$DSH_HOME，默认 ~/.dsh） */
  export function resolveDshHome(): string;
}

/**
 * lunar-javascript（农历库）不带类型声明，这里只声明**我们真正用到**的那几个方法：
 * 一旦升级库导致这些方法改名，tsc 会立刻报错，而不是等运行时静默变成"没有农历"。
 * 库的完整能力（干支/宜忌/八字…）我们不依赖，也就不写进来。
 */
declare module 'lunar-javascript' {
  export interface LunarLike {
    /** 农历日（如「廿七」「初一」） */
    getDayInChinese(): string;
    /** 农历月（如「八」「腊」） */
    getMonthInChinese(): string;
    /** 当天节气名（非节气日为空串） */
    getJieQi(): string;
    /** 当天农历节日（如 ['中秋节']） */
    getFestivals(): string[];
  }
  export interface SolarLike {
    getLunar(): LunarLike;
    /** 当天公历节日（如 ['国庆节']） */
    getFestivals(): string[];
  }
  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarLike;
  };
}
