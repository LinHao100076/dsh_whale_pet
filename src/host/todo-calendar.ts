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

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monthGrid, type DateKey, type MonthKey } from '../shared/calendar';

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

export const HOLIDAY_CACHE_DIR = 'holiday-cn';
/** 缓存格式版本（与上游格式是两件事，见 parseHolidayCache 的说明） */
export const HOLIDAY_CACHE_VERSION = 1;
/** 当年数据可能随公告更新；跨年数据（已过去的年份）不会再变 */
export const HOLIDAY_TTL_MS = 7 * 24 * 3600 * 1000;

/** jsDelivr 上的镜像地址（`@master` 跟随上游，每年公告发布后自动有数据） */
export function holidayCdnUrl(year: number): string {
  return `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
}

/**
 * 解析**上游**文档（NateScarlet/holiday-cn 的形状：`days` 是 `{name,date,isOffDay}` 的**数组**）。
 * 非法行直接跳过，不因为一条脏数据整体失败。
 *
 * ⚠️ 别拿它去读我们自己的缓存——缓存是另一种形状（`days` 已是按日期索引的对象），见 `parseHolidayCache`。
 * 混用会造成"读自己的缓存永远失败"，进而让 TTL 判定与"联网失败回退旧缓存"**同时静默失效**
 * （真实踩过：4 条缓存用例一起变红）。
 */
export function parseHolidayDocument(raw: unknown): HolidayYear | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as { year?: unknown; days?: unknown };
  const year = Number(doc.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Array.isArray(doc.days)) return null;
  const days: Record<DateKey, HolidayDay> = {};
  for (const entry of doc.days) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { name?: unknown; date?: unknown; isOffDay?: unknown };
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (typeof row.isOffDay !== 'boolean') continue;
    if (row.date.slice(0, 4) !== String(year)) continue; // 年份对不上的行不要
    days[row.date] = { name: typeof row.name === 'string' ? row.name : '', off: row.isOffDay };
  }
  return { year, days };
}

/** 解析**我们自己的缓存**文件（自描述格式，见 writeHolidayCache） */
export function parseHolidayCache(raw: unknown): HolidayYear | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as { version?: unknown; year?: unknown; days?: unknown };
  if (doc.version !== HOLIDAY_CACHE_VERSION) return null;
  const year = Number(doc.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!doc.days || typeof doc.days !== 'object' || Array.isArray(doc.days)) return null;
  const days: Record<DateKey, HolidayDay> = {};
  for (const [key, value] of Object.entries(doc.days as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key.slice(0, 4) !== String(year)) continue;
    const row = value as { name?: unknown; off?: unknown } | null;
    if (!row || typeof row !== 'object' || typeof row.off !== 'boolean') continue;
    days[key] = { name: typeof row.name === 'string' ? row.name : '', off: row.off };
  }
  return { year, days };
}

export function holidayCacheFile(root: string, year: number): string {
  return join(root, HOLIDAY_CACHE_DIR, `${year}.json`);
}

/** 读缓存（不存在/损坏 → null，不抛错） */
export async function readHolidayCache(root: string, year: number): Promise<HolidayYear | null> {
  try {
    const raw = await readFile(holidayCacheFile(root, year), 'utf8');
    return parseHolidayCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 原子写缓存（临时文件 + rename，与其它存储一致）；存的是自描述格式，读回走 parseHolidayCache */
export async function writeHolidayCache(root: string, doc: HolidayYear): Promise<void> {
  const dir = join(root, HOLIDAY_CACHE_DIR);
  await mkdir(dir, { recursive: true });
  const target = holidayCacheFile(root, doc.year);
  const temp = join(dir, `.${doc.year}.${process.pid}.${Date.now()}.tmp`);
  const payload = { version: HOLIDAY_CACHE_VERSION, year: doc.year, days: doc.days };
  await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    try {
      await unlink(temp);
    } catch {
      /* best-effort */
    }
    throw error;
  }
}

/** 缓存文件的写入时间（用于 TTL 判定；取不到视为"过期"） */
async function cacheAgeMs(root: string, year: number, now: number): Promise<number | null> {
  try {
    const { stat } = await import('node:fs/promises');
    const info = await stat(holidayCacheFile(root, year));
    return now - info.mtimeMs;
  } catch {
    return null;
  }
}

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
export async function loadHolidayYear(
  root: string,
  year: number,
  options: HolidayLoadOptions = {},
): Promise<HolidayYear | null> {
  const now = options.now ?? Date.now();
  const ttl = options.ttlMs ?? HOLIDAY_TTL_MS;
  const cached = await readHolidayCache(root, year);
  if (cached && !options.force) {
    const age = await cacheAgeMs(root, year, now);
    // 过去的年份数据不会再变 → 永久有效；当年/未来年份 → 超过 TTL 才重取
    const finalYear = year < new Date(now).getFullYear();
    if (finalYear || (age !== null && age < ttl)) return cached;
  }
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const res = await fetchImpl(holidayCdnUrl(year));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseHolidayDocument(await res.json());
    if (!parsed) throw new Error('数据格式不认识');
    await writeHolidayCache(root, parsed);
    return parsed;
  } catch (error) {
    options.warn?.(
      `${year} 年节假日数据获取失败（${error instanceof Error ? error.message : String(error)}），` +
        (cached ? '继续用本地缓存' : '今年不会显示「休/班」角标'),
    );
    return cached;
  }
}

/** 调休角标（休/班）；普通日子返回空对象 */
export function holidayAnnotation(doc: HolidayYear | null, key: DateKey): Pick<TodoDayAnnotation, 'term' | 'dayType'> {
  const day = doc?.days[key];
  if (!day) return {};
  return { term: day.name || undefined, dayType: day.off ? 'off' : 'work' };
}

// ---------------- 农历（lunar-javascript，可选增强） ----------------

/** 我们实际用到的那几个方法（库本身不带类型声明，见 src/types/lunar-javascript.d.ts） */
export interface LunarModule {
  Solar: {
    fromYmd(
      year: number,
      month: number,
      day: number,
    ): {
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

let lunarModulePromise: Promise<LunarModule | null> | undefined;

/**
 * 兼容 CJS/ESM 互操作：`lunar-javascript` 是 CommonJS（`module.exports = { Solar, ... }`）。
 * 经 `import()` 拿到时，命名导出**可能**挂在 `default` 上——取错方向不会报错，
 * 只会让"每天都没有农历"这种静默故障出现，所以这里两种形状都认，都不认就抛。
 */
export function resolveLunarModule(raw: unknown): LunarModule {
  const candidate = raw as { Solar?: unknown; default?: { Solar?: unknown } } | null | undefined;
  const solar = candidate?.Solar ?? candidate?.default?.Solar;
  if (typeof solar !== 'object' || solar === null || typeof (solar as { fromYmd?: unknown }).fromYmd !== 'function') {
    throw new TypeError('lunar-javascript 的模块形状不符合预期（找不到 Solar.fromYmd）');
  }
  return { Solar: solar as LunarModule['Solar'] };
}

/** 动态加载农历库（失败只警告一次，之后一直返回 null） */
export async function loadLunarModule(warn?: (message: string) => void): Promise<LunarModule | null> {
  lunarModulePromise ??= import('lunar-javascript').then(
    (mod) => resolveLunarModule(mod),
    (error: unknown) => {
      warn?.(`农历库不可用（${error instanceof Error ? error.message : String(error)}），日历将不显示农历/节气`);
      return null;
    },
  );
  return lunarModulePromise;
}

/** 测试用：忘掉缓存的模块（每个用例可以重新注入假模块） */
export function resetLunarModuleCache(): void {
  lunarModulePromise = undefined;
}

/**
 * 某天的农历行文案：**节气 > 农历节日 > 农历日**（初一显示月份名，与 Note Calendar 一致）。
 *
 * 有意**不**在这里处理"公历节日"：农历库的公历节日表里塞满了各种国际日
 * （世界住房日/世界动物日…），直接参与这里的优先级会把「国庆节 + 休」这种真正重要的信息盖掉。
 * 公历节日单独走 `solarFestivalTerm`，在组装时排在**法定节假日名之后**（见 buildMonthDays）。
 */
export function lunarAnnotation(module: LunarModule | null, key: DateKey): Pick<TodoDayAnnotation, 'lunar' | 'term'> {
  if (!module) return {};
  const [y, m, d] = key.split('-').map(Number);
  try {
    const solar = module.Solar.fromYmd(y, m, d);
    const lunar = solar.getLunar();
    const term = lunar.getJieQi();
    if (term) return { term };
    const lunarFestival = lunar.getFestivals()[0];
    if (lunarFestival) return { term: lunarFestival };
    const dayName = lunar.getDayInChinese();
    // 农历初一显示月份（如「腊月」），其余显示日（如「廿七」）
    return { lunar: dayName === '初一' ? `${lunar.getMonthInChinese()}月` : dayName };
  } catch {
    return {};
  }
}

/** 公历节日（元旦/国庆节/劳动节…也含国际日）——单独取，优先级压得很低 */
export function solarFestivalTerm(module: LunarModule | null, key: DateKey): string | undefined {
  if (!module) return undefined;
  const [y, m, d] = key.split('-').map(Number);
  try {
    return module.Solar.fromYmd(y, m, d).getFestivals()[0];
  } catch {
    return undefined;
  }
}

// ---------------- 组装一屏的标注 ----------------

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
export async function buildMonthDays(options: BuildMonthOptions): Promise<Record<DateKey, TodoDayAnnotation>> {
  const { root, month } = options;
  const grid = monthGrid(month, 1);
  const keys = grid.flatMap((week) => week.days.map((day) => day.key));
  const years = [...new Set(keys.map((key) => Number(key.slice(0, 4))))];
  const module = options.lunar !== undefined ? options.lunar : await loadLunarModule(options.warn);
  const holidays = new Map<number, HolidayYear | null>();
  await Promise.all(
    years.map(async (year) => {
      holidays.set(
        year,
        await loadHolidayYear(root, year, {
          fetchImpl: options.fetchImpl,
          now: options.now,
          force: options.force,
          warn: options.warn,
        }),
      );
    }),
  );
  const out: Record<DateKey, TodoDayAnnotation> = {};
  for (const key of keys) {
    const holiday = holidayAnnotation(holidays.get(Number(key.slice(0, 4))) ?? null, key);
    const lunar = lunarAnnotation(module, key);
    // 单行单元格的显示优先级（依次退让）：
    //   节气 / 农历节日（农历库）→ 法定节假日名（调休数据，与「休/班」角标配套）→ 公历节日 → 农历日
    // 把"法定节假日名"排在公历节日之前是必要的：否则国庆假期会被「世界住房日」这种国际日盖掉。
    const term = lunar.term ?? holiday.term ?? solarFestivalTerm(module, key);
    const ann: TodoDayAnnotation = {};
    if (term) ann.term = term;
    if (lunar.lunar) ann.lunar = lunar.lunar;
    if (holiday.dayType) ann.dayType = holiday.dayType;
    out[key] = ann;
  }
  return out;
}
