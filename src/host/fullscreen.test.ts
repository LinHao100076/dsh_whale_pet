/**
 * 「有应用全屏时隐藏桌宠」（顶层 hideOnFullscreen）的判定与接线测试。
 *
 * 背景：桌宠是 alwaysOnTop 的透明置顶窗，玩游戏 / 看全屏视频时会一直浮在画面上。开关打开后，
 * helper 主进程按周期问 Windows（SHQueryUserNotificationState）是否"有东西全屏"，再把**被全屏
 * 覆盖那块屏**上的桌宠藏起来，全屏结束自动恢复。
 *
 * 本文件钉住四件事：
 *   ① 判定规则：主判据是 shell 的全屏状态（2/3/4），前台窗口矩形只用来定位是哪块屏；
 *      拿不到/对不上时的退化行为（全部隐藏），以及**最大化窗口不得误判**（系统状态不含它）；
 *   ② 坐标换算：Win32 是物理像素、Electron display.bounds 是 DIP，必须按 scaleFactor 换算
 *      （本 helper 默认强制 dsf=1，此时换算系数就是 1，两种模式同一公式）；
 *   ③ 窗口动作：只隐藏"可见 + 被覆盖屏 + 没开面板"的窗口；只恢复**自己藏起来**的窗口；
 *   ④ 源码守卫：helper 是随包发行的运行时（Electron 起不来），关键接线只能读源码断言。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const {
  QUNS,
  FULLSCREEN_POLL_MS,
  isFullscreenShellState,
  displayPhysicalBounds,
  rectCovers,
  displayIdsCoveredBy,
  resolveHiddenDisplayIds,
  planFullscreenWindows,
} = require(helper + 'fullscreen.js');

/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 单屏 2048×1152 @1.25（真机实测的那台）：物理像素 = 2560×1440 */
const DISPLAY_A = { id: 11, bounds: { x: 0, y: 0, width: 2048, height: 1152 }, scaleFactor: 1.25 };
/** 右侧第二块屏：DIP 起点 2048、缩放 1 → 物理起点 2560 */
const DISPLAY_B = { id: 22, bounds: { x: 2048, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
/** 全屏窗口在 A 屏（物理像素；真机实测值：0,0 - 2560,1440） */
const FS_RECT_A = { x: 0, y: 0, width: 2560, height: 1440 };
/** 最大化窗口（物理像素；真机实测：比屏幕左右各大 9px、底部短 32px，任务栏可见） */
const MAXIMIZED_RECT = { x: -9, y: -9, width: 2578, height: 1408 };

describe('SHQueryUserNotificationState 档位判定 —— 主判据', () => {
  test('2/3/4（全屏应用 / 独占全屏 D3D / 演示模式）算"有东西全屏"', () => {
    assert.equal(isFullscreenShellState(QUNS.BUSY), true);
    assert.equal(isFullscreenShellState(QUNS.RUNNING_D3D_FULL_SCREEN), true);
    assert.equal(isFullscreenShellState(QUNS.PRESENTATION_MODE), true);
  });

  test('1/5/6/7 不算：正常桌面 / 勿扰时间 / 沉浸式应用（语义不同，绝不据此藏桌宠）', () => {
    for (const state of [QUNS.NOT_PRESENT, QUNS.ACCEPTS_NOTIFICATIONS, QUNS.QUIET_TIME, QUNS.APP]) {
      assert.equal(isFullscreenShellState(state), false, 'state=' + state);
    }
  });

  test('非法值（0/NaN/undefined/对象）一律不算——查不到就不许动桌宠', () => {
    // 实现走 Number(state) 归一，所以数字字符串（'2'）会被当成 2；这不构成风险：
    // 该值只来自 koffi 的 int 出参，永远是 number。真正要挡的是"拿不到值"（NaN/undefined/0）。
    for (const state of [0, NaN, undefined, null, {}]) {
      assert.equal(isFullscreenShellState(state as unknown), false, 'state=' + String(state));
    }
  });
});

describe('坐标换算 —— Win32 物理像素 vs Electron DIP', () => {
  test('scaleFactor 参与换算（1.25 → 2048×1152 DIP = 2560×1440 物理）', () => {
    assert.deepEqual(displayPhysicalBounds(DISPLAY_A), { x: 0, y: 0, width: 2560, height: 1440 });
  });

  test('强制 dsf=1 时（默认配置）scaleFactor 报 1，换算即恒等映射', () => {
    assert.deepEqual(displayPhysicalBounds({ ...DISPLAY_A, scaleFactor: 1 }), {
      x: 0,
      y: 0,
      width: 2048,
      height: 1152,
    });
  });

  test('scaleFactor 缺失/非法按 1 处理（不因为一个坏字段把判定算飞）', () => {
    const noScale = { id: DISPLAY_A.id, bounds: DISPLAY_A.bounds };
    assert.deepEqual(displayPhysicalBounds(noScale), { x: 0, y: 0, width: 2048, height: 1152 });
    assert.deepEqual(displayPhysicalBounds({ ...DISPLAY_A, scaleFactor: 0 }), {
      x: 0,
      y: 0,
      width: 2048,
      height: 1152,
    });
  });

  test('跨屏起点也要换算：DIP 起点 2048 在缩放 1 的屏上物理起点还是 2048', () => {
    assert.deepEqual(displayPhysicalBounds(DISPLAY_B), { x: 2048, y: 0, width: 1920, height: 1080 });
  });
});

describe('矩形覆盖判定', () => {
  test('全屏窗口矩形完整盖住 A 屏（真机实测值）', () => {
    assert.equal(rectCovers(FS_RECT_A, displayPhysicalBounds(DISPLAY_A)), true);
    assert.deepEqual(displayIdsCoveredBy(FS_RECT_A, [DISPLAY_A, DISPLAY_B]), [11]);
  });

  test('最大化窗口（任务栏可见）不得算覆盖——这是"正常办公不误藏"的底线', () => {
    assert.equal(rectCovers(MAXIMIZED_RECT, displayPhysicalBounds(DISPLAY_A)), false);
    assert.deepEqual(displayIdsCoveredBy(MAXIMIZED_RECT, [DISPLAY_A, DISPLAY_B]), []);
  });

  test('任务栏自动隐藏时最大化窗口会覆盖整屏：纯矩形判据的危险性由容差外的判断兜住', () => {
    // 这正是"矩形只用来定位哪块屏、不用来判定是否全屏"的原因（见 resolveHiddenDisplayIds）：
    // 交给它判定时，state=5（正常桌面）必须仍然得出"不隐藏"。
    const maximizedCoversAll = { x: 0, y: 0, width: 2560, height: 1440 };
    assert.equal(resolveHiddenDisplayIds(QUNS.ACCEPTS_NOTIFICATIONS, maximizedCoversAll, [DISPLAY_A]), null);
  });

  test('跨屏全屏窗口 → 覆盖到的两块屏都算（都该被藏）', () => {
    const across = { x: 0, y: 0, width: 2560 + 1920, height: 1440 };
    assert.deepEqual(displayIdsCoveredBy(across, [DISPLAY_A, DISPLAY_B]), [11, 22]);
  });

  test('容差：比屏幕小 3px 仍算覆盖，小 40px 不算', () => {
    const inTolerance = { x: 0, y: 0, width: 2560 - 3, height: 1440 - 3 };
    assert.equal(rectCovers(inTolerance, displayPhysicalBounds(DISPLAY_A)), true);
    const tooSmall = { x: 0, y: 0, width: 2560 - 40, height: 1440 - 40 };
    assert.equal(rectCovers(tooSmall, displayPhysicalBounds(DISPLAY_A)), false);
  });

  test('矩形/显示器缺失都不炸（返回不覆盖）', () => {
    assert.equal(rectCovers(null, displayPhysicalBounds(DISPLAY_A)), false);
    assert.equal(rectCovers(FS_RECT_A, null), false);
    assert.deepEqual(displayIdsCoveredBy(null, [DISPLAY_A]), []);
    assert.deepEqual(displayIdsCoveredBy(FS_RECT_A, undefined), []);
  });
});

describe('resolveHiddenDisplayIds —— 本轮该藏哪几块屏', () => {
  const displays = [DISPLAY_A, DISPLAY_B];

  test('没有全屏（state=5）→ null（不藏任何东西）', () => {
    assert.equal(resolveHiddenDisplayIds(QUNS.ACCEPTS_NOTIFICATIONS, MAXIMIZED_RECT, displays), null);
  });

  test('全屏在 A 屏 → 只藏 A（B 屏的桌宠照常活动，这是本次选定的多屏语义）', () => {
    assert.deepEqual(resolveHiddenDisplayIds(QUNS.BUSY, FS_RECT_A, displays), [11]);
  });

  test('全屏在 B 屏 → 只藏 B', () => {
    const fsB = { x: 2048, y: 0, width: 1920, height: 1080 };
    assert.deepEqual(resolveHiddenDisplayIds(QUNS.BUSY, fsB, displays), [22]);
  });

  test('拿不到前台窗口矩形（全屏切换瞬间 GetForegroundWindow=0）→ 全部隐藏（宁可多藏，别在游戏上露脸）', () => {
    assert.deepEqual(resolveHiddenDisplayIds(QUNS.RUNNING_D3D_FULL_SCREEN, null, displays), [11, 22]);
  });

  test('矩形对不上任何屏（DPI 取整 / 虚拟屏）→ 也退化为全部隐藏', () => {
    const weird = { x: -5000, y: -5000, width: 100, height: 100 };
    assert.deepEqual(resolveHiddenDisplayIds(QUNS.PRESENTATION_MODE, weird, displays), [11, 22]);
  });

  test('显示器列表为空 → 空数组（没有任何可藏的东西，且不得抛错）', () => {
    assert.deepEqual(resolveHiddenDisplayIds(QUNS.BUSY, FS_RECT_A, []), []);
  });
});

describe('planFullscreenWindows —— 每一拍的窗口动作', () => {
  const win = (over: Record<string, unknown> = {}) => ({
    id: 1,
    displayId: 11,
    visible: true,
    hiddenByUs: false,
    busy: false,
    ...over,
  });

  test('被覆盖 + 可见 + 没在用 → 隐藏', () => {
    assert.deepEqual(planFullscreenWindows([win()], [11]), { hide: [1], show: [] });
  });

  test('没被覆盖 → 不动（null 也一样：不是全屏场景）', () => {
    assert.deepEqual(planFullscreenWindows([win({ displayId: 22 })], [11]), { hide: [], show: [] });
    assert.deepEqual(planFullscreenWindows([win()], null), { hide: [], show: [] });
  });

  test('用户正在用这个窗口（拖拽 / 菜单 / 弹窗 / 面板）绝不隐藏——放开后下一拍生效', () => {
    assert.deepEqual(planFullscreenWindows([win({ busy: true })], [11]), { hide: [], show: [] });
    assert.deepEqual(planFullscreenWindows([win({ busy: false })], [11]).hide, [1]);
  });

  test('已经藏着的窗口不重复 hide（幂等，800ms 一拍不能反复 hide）', () => {
    assert.deepEqual(planFullscreenWindows([win({ visible: false, hiddenByUs: true })], [11]), {
      hide: [],
      show: [],
    });
  });

  test('不可见但不是本机制藏的（如尚未 show）→ 不 hide，也不越权 show', () => {
    assert.deepEqual(planFullscreenWindows([win({ visible: false, hiddenByUs: false })], [11]), {
      hide: [],
      show: [],
    });
  });

  test('全屏结束 → 只恢复自己藏起来的窗口（绝不去 show 别人藏起来的窗口）', () => {
    const list = [win({ id: 1, visible: false, hiddenByUs: true }), win({ id: 2, visible: false, hiddenByUs: false })];
    assert.deepEqual(planFullscreenWindows(list, null), { hide: [], show: [1] });
  });

  test('多窗口混合：A 屏藏、B 屏恢复，一拍内同时给出 hide 与 show', () => {
    const list = [
      win({ id: 1, displayId: 11, visible: true, hiddenByUs: false }),
      win({ id: 2, displayId: 22, visible: false, hiddenByUs: true }),
    ];
    assert.deepEqual(planFullscreenWindows(list, [11]), { hide: [1], show: [2] });
  });

  test('坏输入（非数组 / 缺 id / null 项）不炸', () => {
    assert.deepEqual(planFullscreenWindows(undefined, [11]), { hide: [], show: [] });
    assert.deepEqual(planFullscreenWindows([null, { displayId: 11 }, win()], [11]), { hide: [1], show: [] });
  });

  test('轮询间隔是 800ms 的命名常量（主进程必须用它，不许各写一个字面量）', () => {
    assert.equal(FULLSCREEN_POLL_MS, 800);
  });
});

describe('源码守卫 —— helper 的接线必须都在位（Electron 起不来，只能读源码断言）', () => {
  const main = readSource(helper + 'main.js');
  const preload = readSource(helper + 'preload.js');
  const renderer = readSource(helper + 'renderer.js');
  const sprite = readSource(helper + 'sprite.js');

  test('取数与判定分层：main.js 只用纯判定的导出，Win32 查询隔离在 fullscreen-probe.js', () => {
    assert.ok(/require\('\.\/fullscreen\.js'\)/.test(main), 'main.js 必须 require 纯判定模块');
    assert.ok(/require\('\.\/fullscreen-probe\.js'\)/.test(main), 'main.js 必须 require Win32 取数模块');
    assert.ok(/planFullscreenWindows\(/.test(main), '窗口动作必须走纯函数（可单测）');
    assert.ok(/resolveHiddenDisplayIds\(/.test(main), '该藏哪几块屏必须走纯函数');
    assert.ok(
      !/SHQueryUserNotificationState|GetForegroundWindow|GetWindowRect/.test(main),
      'main.js 里不得直接出现 Win32 调用（都收在 fullscreen-probe.js）',
    );
  });

  test('开关关闭时零开销：不建 interval，也不 require koffi', () => {
    assert.ok(/DSH_PET_DESKTOP_HIDE_ON_FULLSCREEN/.test(main), '开关必须来自宿主注入的环境变量');
    assert.ok(/function startFullscreenWatch\(\)/.test(main), '必须有一个明确的启动函数');
    assert.ok(
      /if \(!HIDE_ON_FULLSCREEN \|\| fullscreenTimer\) return;/.test(main),
      '未开启时必须直接返回（连探测都不建）',
    );
    assert.ok(/startFullscreenWatch\(\);/.test(main), 'app ready 后必须调用它');
    assert.ok(
      !/require\('koffi'\)/.test(main),
      'koffi 只能在 fullscreen-probe.js 里 require（关闭开关时连模块都不加载）',
    );
    assert.ok(/fullscreenTimer = setInterval\(tick, FULLSCREEN_POLL_MS\)/.test(main), '轮询必须用命名常量间隔');
  });

  test('隐藏/恢复的三条硬约束：记账、面板让路、关闭时清理', () => {
    assert.ok(/const hiddenByFullscreen = new Set\(\)/.test(main), '必须记账"哪些窗口是本机制藏的"');
    assert.ok(/hiddenByFullscreen\.add\(win\.id\)[\s\S]{0,200}?win\.hide\(\)/.test(main), '隐藏 = win.hide()');
    assert.ok(/hiddenByFullscreen\.delete\(win\.id\)[\s\S]{0,200}?win\.show\(\)/.test(main), '恢复 = win.show()');
    assert.ok(/busy: inputBusy\.get\(win\.id\) === true/.test(main), '渲染端输入租约必须传进判定（拖拽中不许藏）');
    assert.ok(
      /win\.on\('closed'[\s\S]{0,400}?hiddenByFullscreen\.delete\(win\.id\)/.test(main),
      '窗口关闭必须清记账（win.id 会复用，串味会去 show 一个不相干的窗口）',
    );
  });

  test('渲染端通知闭环：主进程发 pet:hidden，preload 订阅，renderer 交 sprite 悬挂', () => {
    assert.ok(/win\.webContents\.send\('pet:hidden', !!hidden\)/.test(main), '主进程必须推状态');
    assert.ok(
      /did-finish-load[\s\S]{0,200}?sendFullscreenHidden\(win, hiddenByFullscreen\.has\(win\.id\)\)/.test(main),
      '页面加载完成要补发一次（窗口可能在被藏之后才加载完，那一次通知会丢）',
    );
    assert.ok(/onHidden\(cb\)/.test(preload), 'preload 必须暴露 onHidden');
    assert.ok(/'pet:hidden'/.test(preload), 'IPC 频道名必须与 main.js 一致');
    assert.ok(/window\.petBridge\.onHidden\(/.test(renderer), 'renderer 必须订阅');
    assert.ok(/let fullscreenHidden = false;/.test(renderer), 'renderer 必须有 module 级标志（早于 boot 的异步加载）');
    assert.ok(/s\.setSuspended\(/.test(renderer), 'renderer 必须把状态交给 sprite');
  });

  test('悬挂真的停掉动作与解码（否则隐藏窗口在游戏背后白烧 CPU）', () => {
    assert.ok(/setSuspended\(flag\) \{/.test(sprite), 'sprite 必须有 setSuspended');
    const body = /setSuspended\(flag\) \{([\s\S]*?)\n {2}\}/.exec(sprite);
    assert.ok(body, '找不到 setSuspended 的方法体');
    for (const call of ['this.stopMove()', 'this.stopThrow()', 'this.videoA.pause()', 'this.videoB.pause()']) {
      assert.ok(body[1].includes(call), '悬挂时必须调用 ' + call);
    }
    // 幂等：主进程会在 did-finish-load 补发一次状态，重复调用不得反复暂停/起链
    assert.ok(/if \(next === this\.suspended\) return;/.test(body[1]), 'setSuspended 必须幂等');
  });

  test('事件动画不得把悬挂中的窗口重新拉起来（三处入口都要挡）', () => {
    assert.ok(
      /playOnce\(name\) \{[\s\S]{0,400}?if \(this\.suspended\) \{/.test(sprite),
      'playOnce 必须挡（事件动画/工作状态都从这里进来）',
    );
    assert.ok(/playIdle\(\) \{\n {4}if \(this\.suspended\) return;/.test(sprite), 'playIdle 必须挡');
    assert.ok(
      /handleEnded\(\) \{\n {4}if \(this\.dragState\.active\) return;\n {4}if \(this\.suspended\) return;/.test(sprite),
      'handleEnded 必须挡',
    );
  });
});

describe('源码守卫 —— 配置链路（开关必须能从两处 UI 写进用户配置）', () => {
  const root = (rel: string): string => readSource('../../' + rel);

  test('内置默认配置有 hideOnFullscreen（默认关）', () => {
    assert.ok(/"hideOnFullscreen": false/.test(root('assets/config.jsonc')), 'assets/config.jsonc 必须有该字段');
  });

  test('宿主：开关进 helper 环境变量，且读取失败按关闭处理', () => {
    const host = root('src/host/index.ts');
    assert.ok(/DSH_PET_DESKTOP_HIDE_ON_FULLSCREEN: hideOnFullscreen\(\) \? '1' : '0'/.test(host), '必须注入开关');
    assert.ok(
      /const hideOnFullscreen = \(\): boolean => \{[\s\S]{0,200}?catch \{[\s\S]{0,80}?return false;/.test(host),
      '读配置异常必须回落 false（宁可一直显示，也不误藏）',
    );
  });

  test('两处 UI 都能改：右键气泡面板与 DSH 设置页', () => {
    const panel = root('src/shared/productivity-panel.ts');
    assert.ok(/hideOnFullscreen: globals\.hideOnFullscreen/.test(panel), '右键面板必须提交该字段');
    assert.ok(/main\.hideOnFullscreen === true/.test(panel), '右键面板必须读取该字段的当前值');
    const settings = root('src/client/settings.ts');
    assert.ok(/hideOnFullscreen: hideFullscreen/.test(settings), '设置页必须提交该字段');
    assert.ok(/setHideFullscreen\(m\.hideOnFullscreen\)/.test(settings), '设置页必须读取当前值');
  });

  test('浏览器半侧：只看 Fullscreen API（F11 检测不到，注释里必须说清楚）', () => {
    const pet = root('src/client/pet.ts');
    assert.ok(/document\.fullscreenElement !== null/.test(pet), '浏览器端必须监听 Fullscreen API');
    assert.ok(/hideOnFullscreen && apiFullscreen/.test(pet), '开关关闭时必须照常渲染');
  });
});
