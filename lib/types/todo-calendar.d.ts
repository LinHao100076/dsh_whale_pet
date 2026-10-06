/**
 * 「待办日历」的日期标注层（host 半侧）：农历 / 节气 / 节日 + 休·班调休。
 *
 * 两条数据路刻意分开，因为它们的天性完全不同：
 *
 *   ① **农历/节气/节日**：纯计算，离线。用 `lunar-javascript`（动态 import）。
 *      动态 import 的原因：这个库是可选的增强——包没装上/装坏了，日历照样能用（只是没有农历行），
 *      而不是让整个插件起不来。
 *   ② **休/班调休**：必须联网取当年国务院公告的镜像数据。所以走"缓存优先 + 过期重取 + 失败降级"：
 *      取不到就**只是不显示休/班角标**，绝不阻塞、绝不报错到用户脸上。
 *      数据源：NateScarlet/holiday-cn（每日自动抓取国务院公告，带 papers 溯源链接），走 jsDelivr CDN
 *      （国内可达；raw.githubusercontent 常常不可达）。缓存落在 `<userRoot>/holiday-cn/<年>.json`。
 *
 * 还有一个容易漏的细节：月历网格会**跨年**（一月的第一行常常是去年 12 月），
 * 所以标注要按"网格里出现过的每一年"分别取数，不能只取当前年。
 */
import { type DateKey, type MonthKey } from '../shared/calendar';
/** 某天的附加标注（与 shared/todo-panel.ts 的 TodoDayAnnotation 对应） */
export interface TodoDayAnnotation {
    lunar?: string;
    term?: string;
    dayType?: 'off' | 'work' | null;
}
export interface HolidayDay {
    /** 节日名（如「春节」） */
    name: string;
    /** true = 放假（休）；false = 调休上班（班） */
    off: boolean;
}
export interface HolidayYear {
    year: number;
    /** 只含节假日与调休日；缺省即普通工作日/普通周末 */
    days: Record<DateKey, HolidayDay>;
}
export declare const HOLIDAY_CACHE_DIR = "holiday-cn";
/** 缓存格式版本（与上游格式是两件事，见 parseHolidayCache 的说明） */
export declare const HOLIDAY_CACHE_VERSION = 1;
/** 当年数据可能随公告更新；跨年数据（已过去的年份）不会再变 */
export declare const HOLIDAY_TTL_MS: number;
/** jsDelivr 上的镜像地址（`@master` 跟随上游，每年公告发布后自动有数据） */
export declare function holidayCdnUrl(year: number): string;
/**
 * 解析**上游**文档（NateScarlet/holiday-cn 的形状：`days` 是 `{name,date,isOffDay}` 的**数组**）。
 * 非法行直接跳过，不因为一条脏数据整体失败。
 *
 * ⚠️ 别拿它去读我们自己的缓存——缓存是另一种形状（`days` 已是按日期索引的对象），见 `parseHolidayCache`。
 * 混用会造成"读自己的缓存永远失败"，进而让 TTL 判定与"联网失败回退旧缓存"**同时静默失效**
 * （真实踩过：4 条缓存用例一起变红）。
 */
export declare function parseHolidayDocument(raw: unknown): HolidayYear | null;
/** 解析**我们自己的缓存**文件（自描述格式，见 writeHolidayCache） */
export declare function parseHolidayCache(raw: unknown): HolidayYear | null;
export declare function holidayCacheFile(root: string, year: number): string;
/** 读缓存（不存在/损坏 → null，不抛错） */
export declare function readHolidayCache(root: string, year: number): Promise<HolidayYear | null>;
/** 原子写缓存（临时文件 + rename，与其它存储一致）；存的是自描述格式，读回走 parseHolidayCache */
export declare function writeHolidayCache(root: string, doc: HolidayYear): Promise<void>;
export interface HolidayLoadOptions {
    fetchImpl?: typeof fetch;
    now?: number;
    ttlMs?: number;
    force?: boolean;
    warn?: (message: string) => void;
}
/**
 * 取某一年的调休数据：**缓存优先** → 缺失或过期才联网 → 联网失败就用旧缓存 → 什么都没有则 null。
 * 全程不抛错（调用方拿 null 就是不显示休/班角标）。
 */
export declare function loadHolidayYear(root: string, year: number, options?: HolidayLoadOptions): Promise<HolidayYear | null>;
/** 调休角标（休/班）；普通日子返回空对象 */
export declare function holidayAnnotation(doc: HolidayYear | null, key: DateKey): Pick<TodoDayAnnotation, 'term' | 'dayType'>;
/** 我们实际用到的那几个方法（库本身不带类型声明，见 src/types/lunar-javascript.d.ts） */
export interface LunarModule {
    Solar: {
        fromYmd(year: number, month: number, day: number): {
            getLunar(): {
                getDayInChinese(): string;
                getMonthInChinese(): string;
                getJieQi(): string;
                getFestivals(): string[];
            };
            getFestivals(): string[];
        };
    };
}
/**
 * 兼容 CJS/ESM 互操作：`lunar-javascript` 是 CommonJS（`module.exports = { Solar, ... }`）。
 * 经 `import()` 拿到时，命名导出**可能**挂在 `default` 上——取错方向不会报错，
 * 只会让"每天都没有农历"这种静默故障出现，所以这里两种形状都认，都不认就抛。
 */
export declare function resolveLunarModule(raw: unknown): LunarModule;
/** 动态加载农历库（失败只警告一次，之后一直返回 null） */
export declare function loadLunarModule(warn?: (message: string) => void): Promise<LunarModule | null>;
/** 测试用：忘掉缓存的模块（每个用例可以重新注入假模块） */
export declare function resetLunarModuleCache(): void;
/**
 * 某天的农历行文案：**节气 > 农历节日 > 农历日**（初一显示月份名，与 Note Calendar 一致）。
 *
 * 有意**不**在这里处理"公历节日"：农历库的公历节日表里塞满了各种国际日
 * （世界住房日/世界动物日…），直接参与这里的优先级会把「国庆节 + 休」这种真正重要的信息盖掉。
 * 公历节日单独走 `solarFestivalTerm`，在组装时排在**法定节假日名之后**（见 buildMonthDays）。
 */
export declare function lunarAnnotation(module: LunarModule | null, key: DateKey): Pick<TodoDayAnnotation, 'lunar' | 'term'>;
/** 公历节日（元旦/国庆节/劳动节…也含国际日）——单独取，优先级压得很低 */
export declare function solarFestivalTerm(module: LunarModule | null, key: DateKey): string | undefined;
export interface BuildMonthOptions {
    root: string;
    month: MonthKey;
    /** 注入农历模块（测试用）；缺省走动态 import */
    lunar?: LunarModule | null;
    fetchImpl?: typeof fetch;
    now?: number;
    force?: boolean;
    warn?: (message: string) => void;
}
/**
 * 生成某个月（整个网格）的逐日标注。
 * 网格跨年时会把两边的调休数据都取上（一月的第一行常常是去年 12 月）。
 */
export declare function buildMonthDays(options: BuildMonthOptions): Promise<Record<DateKey, TodoDayAnnotation>>;
