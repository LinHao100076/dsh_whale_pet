/**
 * 日期标注层测试：调休数据解析/缓存/降级、农历行文案、逐日标注组装。
 *
 * 注意这里**不依赖真实网络**：fetch 用假的注入，农历模块也用假的注入
 * （真实农历库的正确性由另一组"已知日期"用例单独验证：见文件末尾）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMonthDays,
  holidayAnnotation,
  holidayCacheFile,
  holidayCdnUrl,
  loadHolidayYear,
  lunarAnnotation,
  parseHolidayDocument,
  readHolidayCache,
  resolveLunarModule,
  solarFestivalTerm,
  writeHolidayCache,
  type HolidayYear,
  type LunarModule,
} from './todo-calendar.ts';

/** 上游文档的真实形状（截取 2026 年几行） */
const RAW_2026 = {
  $schema: 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/schema.json',
  year: 2026,
  papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
  days: [
    { name: '元旦', date: '2026-01-01', isOffDay: true },
    { name: '元旦', date: '2026-01-04', isOffDay: false },
    { name: '春节', date: '2026-02-14', isOffDay: false },
    { name: '春节', date: '2026-02-17', isOffDay: true },
    { name: '国庆节', date: '2026-10-10', isOffDay: false },
  ],
};

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-todocal-'));
  const done = (): void => rmSync(dir, { recursive: true, force: true });
  try {
    const result = fn(dir);
    if (result instanceof Promise) return result.finally(done);
    done();
    return undefined;
  } catch (error) {
    done();
    throw error;
  }
}

/** 假的农历模块：只认几条写死的日期，够验证"取用顺序" */
function fakeLunar(
  rows: Record<string, { day?: string; month?: string; jieQi?: string; lunarFest?: string[]; solarFest?: string[] }>,
): LunarModule {
  return {
    Solar: {
      fromYmd(y, m, d) {
        const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const row = rows[key] ?? {};
        return {
          getLunar: () => ({
            getDayInChinese: () => row.day ?? '十五',
            getMonthInChinese: () => row.month ?? '正',
            getJieQi: () => row.jieQi ?? '',
            getFestivals: () => row.lunarFest ?? [],
          }),
          getFestivals: () => row.solarFest ?? [],
        };
      },
    },
  };
}

describe('调休数据解析', () => {
  test('只认 date/isOffDay，年份对不上的行丢掉，脏行不拖垮整份', () => {
    const doc = parseHolidayDocument({
      year: 2026,
      days: [
        { name: '元旦', date: '2026-01-01', isOffDay: true },
        { name: '跨年脏数据', date: '2025-12-31', isOffDay: true }, // 年份不符 → 丢
        { name: '缺 isOffDay', date: '2026-01-02' }, // 丢
        { name: '日期格式错', date: '2026/01/03', isOffDay: true }, // 丢
        null,
        'string',
        { name: '春节', date: '2026-02-17', isOffDay: true },
      ],
    });
    assert.ok(doc);
    assert.equal(doc.year, 2026);
    assert.deepEqual(Object.keys(doc.days).sort(), ['2026-01-01', '2026-02-17']);
    assert.deepEqual(doc.days['2026-01-01'], { name: '元旦', off: true });
  });

  test('整体非法 → null（而不是抛错）', () => {
    for (const raw of [
      null,
      'x',
      42,
      { year: 0, days: [] },
      { year: 2026 },
      { year: 2026, days: 'x' },
      { year: 1900, days: [] },
    ]) {
      assert.equal(parseHolidayDocument(raw), null, JSON.stringify(raw));
    }
  });

  test('CDN 地址按年份拼', () => {
    assert.equal(holidayCdnUrl(2026), 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/2026.json');
  });
});

describe('调休缓存与降级', () => {
  test('写→读 往返一致（原子写到 holiday-cn/<年>.json）', () =>
    withTempDir(async (dir) => {
      const doc = parseHolidayDocument(RAW_2026);
      assert.ok(doc);
      await writeHolidayCache(dir, doc);
      assert.ok(existsSync(holidayCacheFile(dir, 2026)));
      assert.deepEqual(await readHolidayCache(dir, 2026), doc);
      assert.ok(readFileSync(holidayCacheFile(dir, 2026), 'utf8').endsWith('\n'));
    }));

  test('缓存损坏 → null（不抛错）', () =>
    withTempDir(async (dir) => {
      await writeHolidayCache(dir, { year: 2026, days: {} });
      const file = holidayCacheFile(dir, 2026);
      writeFileSync(file, 'not json', 'utf8');
      assert.equal(await readHolidayCache(dir, 2026), null);
    }));

  test('缓存与上游是两种格式：把上游数组格式的文件当缓存读不进来（防混用）', () =>
    withTempDir(async (dir) => {
      mkdirSync(join(dir, 'holiday-cn'), { recursive: true });
      writeFileSync(holidayCacheFile(dir, 2026), JSON.stringify(RAW_2026), 'utf8');
      assert.equal(await readHolidayCache(dir, 2026), null, '按缓存格式解析必须失败');
      assert.ok(parseHolidayDocument(RAW_2026), '同一个对象按上游格式解析是成功的');
    }));

  test('没缓存 + 联网失败 → null（降级，不抛错）并告警', () =>
    withTempDir(async (dir) => {
      const warns: string[] = [];
      const out = await loadHolidayYear(dir, 2026, {
        fetchImpl: async () => {
          throw new Error('网络炸了');
        },
        warn: (m) => warns.push(m),
      });
      assert.equal(out, null);
      assert.match(warns.join(''), /不会显示「休\/班」角标/);
    }));

  test('有缓存 + 联网失败 → 继续用缓存（旧数据也比没有强）', () =>
    withTempDir(async (dir) => {
      const doc = parseHolidayDocument(RAW_2026);
      assert.ok(doc);
      await writeHolidayCache(dir, doc);
      const out = await loadHolidayYear(dir, 2026, {
        force: true, // 强制绕过 TTL → 一定会去联网
        now: new Date('2026-06-01T00:00:00').getTime(),
        fetchImpl: async () => {
          throw new Error('网络炸了');
        },
      });
      assert.deepEqual(out, doc);
    }));

  test('HTTP 404（该年数据还没发布）→ null 且不写缓存', () =>
    withTempDir(async (dir) => {
      const out = await loadHolidayYear(dir, 2099, {
        fetchImpl: async () => new Response('nope', { status: 404 }),
      });
      assert.equal(out, null);
      assert.equal(existsSync(holidayCacheFile(dir, 2099)), false);
    }));

  test('联网成功 → 写入缓存，且第二次不再联网（TTL 内）', () =>
    withTempDir(async (dir) => {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify(RAW_2026), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const now = new Date('2026-06-01T00:00:00').getTime();
      const first = await loadHolidayYear(dir, 2026, { fetchImpl, now });
      const second = await loadHolidayYear(dir, 2026, { fetchImpl, now });
      assert.equal(calls, 1, 'TTL 内不该第二次联网');
      assert.deepEqual(first, second);
    }));

  test('过去的年份：数据已定稿，即使缓存很旧也不联网', () =>
    withTempDir(async (dir) => {
      const doc = parseHolidayDocument({ ...RAW_2026, year: 2025 });
      assert.ok(doc);
      await writeHolidayCache(dir, doc);
      let calls = 0;
      const out = await loadHolidayYear(dir, 2025, {
        now: new Date('2030-01-01T00:00:00').getTime(), // 五年后
        fetchImpl: async () => {
          calls += 1;
          return new Response('{}', { status: 200 });
        },
      });
      assert.equal(calls, 0, '过去的年份不该再联网');
      assert.deepEqual(out, doc);
    }));
});

describe('标注文案', () => {
  test('调休角标：休/班/普通日', () => {
    const doc: HolidayYear = {
      year: 2026,
      days: { '2026-10-01': { name: '国庆节', off: true }, '2026-10-10': { name: '国庆节', off: false } },
    };
    assert.deepEqual(holidayAnnotation(doc, '2026-10-01'), { term: '国庆节', dayType: 'off' });
    assert.deepEqual(holidayAnnotation(doc, '2026-10-10'), { term: '国庆节', dayType: 'work' });
    assert.deepEqual(holidayAnnotation(doc, '2026-10-05'), {});
    assert.deepEqual(holidayAnnotation(null, '2026-10-01'), {});
  });

  test('农历行取用顺序：节气 > 农历节日 > 农历日（公历节日单独取）', () => {
    const module = fakeLunar({
      '2026-10-08': { day: '廿七', jieQi: '寒露' },
      '2026-09-25': { day: '十五', lunarFest: ['中秋节'] },
      '2026-10-01': { day: '廿一', solarFest: ['国庆节'] },
      '2026-02-17': { day: '初一', month: '正' },
      '2026-10-06': { day: '廿五' },
    });
    assert.deepEqual(lunarAnnotation(module, '2026-10-08'), { term: '寒露' });
    assert.deepEqual(lunarAnnotation(module, '2026-09-25'), { term: '中秋节' });
    // 公历节日不在 lunarAnnotation 里（否则会盖掉法定节假日名），而是单独的取用口
    assert.deepEqual(lunarAnnotation(module, '2026-10-01'), { lunar: '廿一' });
    assert.equal(solarFestivalTerm(module, '2026-10-01'), '国庆节');
    // 农历初一显示月份名（与 Note Calendar 的"初一显示月份"一致）
    assert.deepEqual(lunarAnnotation(module, '2026-02-17'), { lunar: '正月' });
    assert.deepEqual(lunarAnnotation(module, '2026-10-06'), { lunar: '廿五' });
  });

  test('没有农历库 → 空标注（不抛错，日历照常）', () => {
    assert.deepEqual(lunarAnnotation(null, '2026-10-08'), {});
  });

  test('库内部抛错 → 空标注（一条坏数据不该毁掉整屏）', () => {
    const broken = {
      Solar: {
        fromYmd() {
          throw new Error('boom');
        },
      },
    } as unknown as LunarModule;
    assert.deepEqual(lunarAnnotation(broken, '2026-10-08'), {});
  });
});

describe('组装一屏标注', () => {
  test('农历 + 调休合并；网格跨年时两边的调休数据都要取', () =>
    withTempDir(async (dir) => {
      const fetched: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        fetched.push(url);
        const year = url.endsWith('2025.json') ? 2025 : 2026;
        const rows =
          year === 2025
            ? [{ name: '元旦', date: '2025-12-31', isOffDay: false }]
            : [{ name: '元旦', date: '2026-01-01', isOffDay: true }];
        return new Response(JSON.stringify({ year, days: rows }), { status: 200 });
      };
      const days = await buildMonthDays({
        root: dir,
        month: '2026-01',
        lunar: fakeLunar({ '2026-01-01': { day: '十三' } }),
        fetchImpl,
        now: new Date('2026-01-05T00:00:00').getTime(),
      });
      assert.equal(fetched.length, 2, '跨年网格必须取两年数据');
      assert.deepEqual(days['2026-01-01'], { term: '元旦', lunar: '十三', dayType: 'off' });
      // 2025-12-31 是「班」；它的农历来自 fakeLunar 的默认值（十五）
      assert.deepEqual(days['2025-12-31'], { term: '元旦', lunar: '十五', dayType: 'work' });
      // 没有标注的日子也要在结果里（格子遍历时直接查，缺 key 会变 undefined）
      assert.ok('2026-01-15' in days);
    }));

  test('数据全都取不到 → 每个格子都是空对象（面板据此不显示标注）', () =>
    withTempDir(async (dir) => {
      const days = await buildMonthDays({
        root: dir,
        month: '2026-10',
        lunar: null,
        fetchImpl: async () => {
          throw new Error('down');
        },
      });
      assert.ok(Object.keys(days).length >= 35);
      for (const ann of Object.values(days)) assert.deepEqual(ann, {});
    }));
});

/**
 * 真实农历库的"已知日期"验证：这些日期是公开事实，用来证明我们用对了 API
 * （不是证明库本身对——那是上游的事）。库没装上时跳过。
 */
describe('真实农历库：已知日期', () => {
  test('模块形状解析（CJS 的命名导出可能挂在 default 上）', () => {
    const solar = { fromYmd: () => ({}) };
    assert.deepEqual(resolveLunarModule({ Solar: solar }), { Solar: solar });
    assert.deepEqual(resolveLunarModule({ default: { Solar: solar } }), { Solar: solar });
    assert.throws(() => resolveLunarModule({}), /模块形状/);
    assert.throws(() => resolveLunarModule(null), /模块形状/);
  });

  test('2026 春节 / 中秋 / 寒露 / 国庆', async () => {
    let module: LunarModule;
    try {
      module = resolveLunarModule(await import('lunar-javascript'));
    } catch (error) {
      // 依赖缺失不应让测试变红（它被设计成可选增强），但要明确说出来
      console.log(
        `[skip] lunar-javascript 不可用（${error instanceof Error ? error.message : String(error)}），跳过真实农历断言`,
      );
      return;
    }
    // 2026-02-17 = 正月初一（春节）——库把「春节」放在农历节日里，所以优先显示节日名
    assert.deepEqual(lunarAnnotation(module, '2026-02-17'), { term: '春节' });
    // 2026-09-25 = 八月十五（中秋）
    const midAutumn = lunarAnnotation(module, '2026-09-25');
    assert.ok(midAutumn.term === '中秋节' || midAutumn.lunar === '十五', JSON.stringify(midAutumn));
    // 2026-10-08 = 寒露（节气）
    assert.deepEqual(lunarAnnotation(module, '2026-10-08'), { term: '寒露' });
    // 2026-10-01 = 国庆节（公历节日走单独的取用口）
    assert.equal(solarFestivalTerm(module, '2026-10-01'), '国庆节');
    // 普通日子给出农历日
    assert.deepEqual(lunarAnnotation(module, '2026-10-06'), { lunar: '廿六' });
  });
});

/**
 * 真实数据端到端：**真农历库 + 真实调休数据**（2026 年那份国务院公告的镜像内容）
 * 跑完整条 `buildMonthDays`，验证 2026 年 10 月这一屏的标注形状。
 * 这条用例是"面板上会看到什么"的最直接证据，比任何单独的函数断言都强。
 */
describe('真实数据端到端：2026 年 10 月', () => {
  // 摘自 NateScarlet/holiday-cn 的 2026.json（真实内容，未加工）
  const REAL_2026 = {
    year: 2026,
    papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
    days: [
      { name: '元旦', date: '2026-01-01', isOffDay: true },
      { name: '元旦', date: '2026-01-02', isOffDay: true },
      { name: '元旦', date: '2026-01-03', isOffDay: true },
      { name: '元旦', date: '2026-01-04', isOffDay: false },
      { name: '春节', date: '2026-02-14', isOffDay: false },
      { name: '春节', date: '2026-02-15', isOffDay: true },
      { name: '春节', date: '2026-02-17', isOffDay: true },
      { name: '春节', date: '2026-02-23', isOffDay: true },
      { name: '春节', date: '2026-02-28', isOffDay: false },
      { name: '清明节', date: '2026-04-04', isOffDay: true },
      { name: '劳动节', date: '2026-05-01', isOffDay: true },
      { name: '劳动节', date: '2026-05-09', isOffDay: false },
      { name: '端午节', date: '2026-06-19', isOffDay: true },
      { name: '国庆节', date: '2026-09-20', isOffDay: false },
      { name: '中秋节', date: '2026-09-25', isOffDay: true },
      { name: '中秋节', date: '2026-09-27', isOffDay: true },
      { name: '国庆节', date: '2026-10-01', isOffDay: true },
      { name: '国庆节', date: '2026-10-02', isOffDay: true },
      { name: '国庆节', date: '2026-10-03', isOffDay: true },
      { name: '国庆节', date: '2026-10-04', isOffDay: true },
      { name: '国庆节', date: '2026-10-05', isOffDay: true },
      { name: '国庆节', date: '2026-10-06', isOffDay: true },
      { name: '国庆节', date: '2026-10-07', isOffDay: true },
      { name: '国庆节', date: '2026-10-10', isOffDay: false },
    ],
  };

  test('10 月整屏：国庆休 7 天、10-10 调休上班、10-08 寒露', async () => {
    let module: LunarModule;
    try {
      module = resolveLunarModule(await import('lunar-javascript'));
    } catch (error) {
      console.log(`[skip] lunar-javascript 不可用：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await withTempDir(async (dir) => {
      const days = await buildMonthDays({
        root: dir,
        month: '2026-10',
        lunar: module,
        fetchImpl: async () => new Response(JSON.stringify(REAL_2026), { status: 200 }),
        now: new Date('2026-10-05T09:00:00').getTime(),
      });
      // 国庆：1-7 号全是「休」
      for (let d = 1; d <= 7; d++) {
        const key = `2026-10-0${d}`;
        assert.equal(days[key].dayType, 'off', `${key} 应放假`);
        assert.equal(days[key].term, '国庆节', `${key} 应标国庆节`);
      }
      // 10-08 是节气：单元格只有一行，节气占位后不再显示农历日（设计如此）
      assert.equal(days['2026-10-08'].term, '寒露');
      assert.equal(days['2026-10-08'].lunar, undefined);
      assert.equal(days['2026-10-08'].dayType, undefined);
      // 10-10 调休上班
      assert.equal(days['2026-10-10'].dayType, 'work');
      // 普通日子只有农历；6 号仍在国庆假期里
      assert.equal(days['2026-10-06'].dayType, 'off');
      assert.equal(days['2026-10-20'].term, undefined);
      assert.ok(days['2026-10-20'].lunar, '普通日子必须有农历日');
      // 缓存已写入（下一次不用联网）
      assert.ok(existsSync(holidayCacheFile(dir, 2026)));
      assert.deepEqual(days['2026-10-05'], { term: '国庆节', lunar: '廿五', dayType: 'off' });
    });
  });
});
