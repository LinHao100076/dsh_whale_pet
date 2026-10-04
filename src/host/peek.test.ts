/**
 * 「窥屏吐槽」的提示词拼装与接线测试。
 *
 * 背景：宠物按周期偷看一眼主人在干嘛（前台窗口标题 + 进程名 + 空闲时长，可选屏幕截图），
 * 交给模型吐槽一句，走碎碎念同款气泡展示；番茄钟在跑时换成督促语气。
 *
 * 本文件钉住四件事：
 *   ① 情报拼装：窗口信息缺失时**不许编造**场景（要显式说"没看到前台窗口"）；空闲时长只在够久时才提；
 *      番茄钟信息按阶段产出，关闭联动时一个字都不进提示词；
 *   ② 指令拼装：专注/休息/无番茄钟三种态度规则都在，带截图时额外说明"只挑一点说"；
 *   ③ 图片能力判定：显式支持 → send；显式不支持 → skip（别发必然失败的请求）；未知 → try（先试一次）；
 *   ④ 源码守卫：情报取自 helper 的 Win32 查询、截图走 desktopCapturer、开关默认关、宿主 /peek 是 POST。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildPeekInstruction, buildPeekIntel, decideImageUse, IMAGE_MODALITY } from './peek.ts';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const FOCUS = {
  phase: 'focus' as const,
  running: true,
  remainingSeconds: 12 * 60,
  taskTitle: '写窥屏功能',
  completedFocusCycles: 2,
};

describe('decideImageUse —— 截图发不发（纯函数）', () => {
  test('元数据缺失/空 → try（未知能力：先试一次，失败自动退回纯情报）', () => {
    assert.equal(decideImageUse(undefined), 'try');
    assert.equal(decideImageUse(null), 'try');
    assert.equal(decideImageUse([]), 'try');
  });

  test('显式声明支持图片 → send', () => {
    assert.equal(decideImageUse([IMAGE_MODALITY, 'text']), 'send');
    assert.equal(decideImageUse(['text', 'image']), 'send');
  });

  test('显式不含图片（明确否定的能力）→ skip：不发必然失败的请求', () => {
    assert.equal(decideImageUse(['text']), 'skip');
    assert.equal(decideImageUse(['text', 'audio']), 'skip');
  });

  test('模态名大小写敏感：dsh-llm 的取值就是字面量 image', () => {
    assert.equal(decideImageUse(['Image']), 'skip');
    assert.equal(IMAGE_MODALITY, 'image');
  });
});

describe('buildPeekIntel —— 情报拼装（纯函数）', () => {
  test('进程名 + 窗口标题都给时，两个都写进去', () => {
    const text = buildPeekIntel({ context: { processName: 'Code.exe', windowTitle: 'main.js - dsh-pet-desktop' } });
    assert.match(text, /Code\.exe/);
    assert.match(text, /main\.js - dsh-pet-desktop/);
  });

  test('只有进程名 / 只有标题：都不能编造另一半', () => {
    const onlyProc = buildPeekIntel({ context: { processName: 'chrome.exe' } });
    assert.match(onlyProc, /chrome\.exe/);
    assert.doesNotMatch(onlyProc, /窗口标题/);
    const onlyTitle = buildPeekIntel({ context: { windowTitle: '某个页面' } });
    assert.match(onlyTitle, /未知程序/);
    assert.match(onlyTitle, /某个页面/);
  });

  test('窗口情报全空 → 显式写"没看到"，绝不编一个场景出来', () => {
    const text = buildPeekIntel({ context: {} });
    assert.match(text, /没看到前台窗口/);
  });

  test('空闲时长：低于 60 秒不提，达到才写"X 分钟没有动键鼠"', () => {
    assert.doesNotMatch(buildPeekIntel({ context: { processName: 'a.exe', idleSeconds: 30 } }), /没有动键鼠/);
    const text = buildPeekIntel({ context: { processName: 'a.exe', idleSeconds: 6 * 60 } });
    assert.match(text, /6 分钟没有动键鼠/);
  });

  test('番茄钟：阶段/剩余/任务/周期数都进情报', () => {
    const text = buildPeekIntel({ context: { processName: 'a.exe' }, pomodoro: FOCUS });
    assert.match(text, /专注中/);
    assert.match(text, /还剩 12 分钟/);
    assert.match(text, /写窥屏功能/);
    assert.match(text, /已完成 2 个专注周期/);
  });

  test('番茄钟：暂停时标注"已暂停"；休息阶段用休息的中文名', () => {
    const paused = buildPeekIntel({
      context: {},
      pomodoro: { ...FOCUS, running: false, remainingSeconds: 30 },
    });
    assert.match(paused, /已暂停/);
    assert.match(paused, /还剩 30 秒/);
    const brk = buildPeekIntel({ context: {}, pomodoro: { ...FOCUS, phase: 'shortBreak' } });
    assert.match(brk, /短休息/);
  });

  test('番茄钟缺失 / 关闭联动（null）→ 情报里一个字都不提番茄钟', () => {
    assert.doesNotMatch(buildPeekIntel({ context: { processName: 'a.exe' }, pomodoro: null }), /番茄钟/);
    assert.doesNotMatch(buildPeekIntel({ context: { processName: 'a.exe' } }), /番茄钟/);
  });
});

describe('buildPeekInstruction —— 态度规则（纯函数）', () => {
  test('三种阶段的规则都在：专注督促 / 摸鱼点名 / 休息放松 / 无番茄钟', () => {
    const text = buildPeekInstruction(false);
    assert.match(text, /专注阶段/);
    assert.match(text, /摸鱼/);
    assert.match(text, /休息阶段/);
    assert.match(text, /没有番茄钟情报/);
  });

  test('只说一句、不许复述标题/解释偷看/提 AI —— 这几条是气泡长度的护栏', () => {
    const text = buildPeekInstruction(false);
    assert.match(text, /15~25 字/);
    assert.match(text, /不要复述窗口标题/);
    assert.match(text, /不要解释你在偷看/);
    assert.match(text, /不要提你是 AI/);
  });

  test('带截图：额外说明"只挑一点说、不要逐条描述画面"；不带截图时绝口不提截图', () => {
    const withImage = buildPeekInstruction(true);
    assert.match(withImage, /截图/);
    assert.match(withImage, /不要逐条描述画面/);
    assert.doesNotMatch(buildPeekInstruction(false), /截图/);
  });
});

describe('源码守卫 —— 情报与截图的取数链路（Electron 起不来，只能读源码断言）', () => {
  const main = readSource(helper + 'main.js');
  const preload = readSource(helper + 'preload.js');
  const events = readSource(helper + 'events.js');
  const sprite = readSource(helper + 'sprite.js');
  const constants = readSource(helper + 'constants.js');

  test('窗口情报走独立 probe，且带开关（关闭时零开销：连 koffi 都不 require）', () => {
    assert.ok(/DSH_PET_DESKTOP_PEEK/.test(main), '开关必须来自宿主注入的环境变量');
    assert.ok(/ipcMain\.handle\('pet:peek-context'/.test(main), '渲染端要能通过 IPC 问窗口情报');
    assert.ok(
      /if \(!PEEK_ENABLED\) return null;[\s\S]{0,200}?require\('\.\/peek-probe\.js'\)/.test(main),
      'koffi 探测必须懒建且关在开关后面',
    );
    assert.ok(!/require\('koffi'\)/.test(main), 'koffi 只能在 peek-probe.js / fullscreen-probe.js 里 require');
    assert.ok(/idleSeconds/.test(main + readSource(helper + 'peek-probe.js')), '空闲时长要一起取');
  });

  test('截图走 desktopCapturer，跟随光标所在屏，JPEG 质量/尺寸有命名常量', () => {
    assert.ok(/desktopCapturer/.test(main), '必须用 Electron 的 desktopCapturer（不需要 FFI）');
    assert.ok(/ipcMain\.handle\('pet:peek-shot'/.test(main), '截图也要有 IPC 入口');
    assert.ok(/getDisplayNearestPoint\(screen\.getCursorScreenPoint\(\)\)/.test(main), '拍人正在看的那块屏');
    assert.ok(/toJPEG\(PEEK_SHOT_QUALITY\)/.test(main), '缩略图转 JPEG（实测 ~60KB，走 bridge 够用）');
    assert.ok(/PEEK_SHOT_SIZE = \{ width: 1280, height: 720 \}/.test(main), '尺寸常量必须命名（可调）');
  });

  test('渲染端：窥屏循环按宠物开关与配置周期来，展示复用碎碎念链路', () => {
    assert.ok(/startPeekLoop/.test(events), '每只宠物一个窥屏循环');
    assert.ok(
      /if \(!this\.pet\.peekEnabled \|\| this\.peekLoopTimer !== null\) return;/.test(events),
      '未开启的宠物不得建循环',
    );
    assert.ok(/Math\.max\(30_000,/.test(events), '周期下限 30s：别把模型当玩具');
    assert.ok(/S\.sendPeek\(PEEK_URL/.test(events), '走 shared 的请求封装（两端同一份契约）');
    assert.ok(/this\.showWhisper\(state\.text, state\.image\)/.test(events), '展示复用碎碎念（气泡 + 配图）');
    assert.ok(/for \(const s of sprites\) s\.startPeekLoop\(\);/.test(events), 'startLoops 必须把它挂上');
    assert.ok(
      /peekLoopTimer/.test(sprite) && /clearInterval\(this\.peekLoopTimer\)/.test(sprite),
      'dispose 必须清循环',
    );
  });

  test('右键菜单能手动触发（不受 peekEnabled 门控，与碎碎念同语义）', () => {
    assert.ok(/\{ label: '窥屏吐槽', action: 'peek' \}/.test(sprite), '菜单项必须在');
    assert.ok(/leaf\.action === 'peek'/.test(sprite), '动作必须被分发');
    assert.ok(/showPeekFromMenu\(\)/.test(sprite), '手动触发有独立方法');
    assert.ok(/\?force=1/.test(sprite), '手动触发要绕过节流');
  });

  test('preload 暴露的两个方法名与主进程 IPC 频道一致', () => {
    assert.ok(/peekContext\(\)/.test(preload) && /'pet:peek-context'/.test(preload));
    assert.ok(/peekShot\(\)/.test(preload) && /'pet:peek-shot'/.test(preload));
    assert.ok(/const PEEK_URL = BASE \+ '\/peek'/.test(constants), '端点常量必须与宿主路由一致');
  });

  test('peek-probe 是纯取数模块：非 Windows 直接返回 null（功能静默降级）', () => {
    const probe = require(helper + 'peek-probe.js') as { createPeekProbe?: unknown };
    assert.equal(typeof probe.createPeekProbe, 'function', '必须导出 createPeekProbe');
    const src = readSource(helper + 'peek-probe.js');
    assert.ok(/if \(process\.platform !== 'win32'\) return null;/.test(src), '非 Windows 必须直接降级');
    assert.ok(/GetForegroundWindow/.test(src) && /GetWindowTextW/.test(src), '窗口标题走宽字符版 API');
    assert.ok(/QueryFullProcessImageNameW/.test(src), '进程名走 QueryFullProcessImageName');
    assert.ok(/split\(\/\[\\\\\/\]\//.test(src), '进程名只取文件名（路径里常有用户名，不进提示词）');
  });
});

describe('源码守卫 —— 宿主链路（路由 / 开关注入 / 番茄钟 / 截图降级）', () => {
  const host = readSource('../host/index.ts');

  test('/peek 是 POST（情报由发起端提供），并支持 force 手动触发', () => {
    assert.ok(/if \(rest === 'peek'\)/.test(host), '必须有 /peek 路由');
    assert.ok(/if \(method !== 'POST'\) return \{ kind: 'json', status: 405/.test(host), '只接受 POST');
    assert.ok(/url\.searchParams\.get\('force'\) === '1'/.test(host), '手动触发走 force=1');
    assert.ok(/servePeek\(petId, parsed\.context, parsed\.image, force\)/.test(host), '情报/截图都从请求体来');
  });

  test('宿主侧节流 + 番茄钟情报 + 截图能力判定都在', () => {
    assert.ok(/const peekCache = new Map/.test(host), '必须有按宠物的节流缓存');
    assert.ok(/reconcileProductivitySnapshot\(userRoot\)/.test(host), '番茄钟直接读 productivity 存储');
    assert.ok(/decideImageUse\(await peekInputModalities\(\)\)/.test(host), '截图前必须做模型能力判定');
    assert.ok(/resolveModelInfo/.test(host), '能力来自 dsh-llm 的模型元数据');
    assert.ok(/peekImageWarned/.test(host), '"模型不支持图片"每宠物只提示一次');
    assert.ok(/if \(result\.imageDropped\) out\.imageDropped = true;/.test(host), '退回纯情报要告诉渲染端');
  });

  test('开关注入：任一只宠物开了窥屏才给 helper 开能力', () => {
    assert.ok(/DSH_PET_DESKTOP_PEEK: peekEnabled\(\) \? '1' : '0'/.test(host));
    assert.ok(
      /const peekEnabled = \(\): boolean => \{[\s\S]{0,200}?catch \{[\s\S]{0,60}?return false;/.test(host),
      '读配置异常必须回落关闭（宁可什么都不看）',
    );
  });

  test('内置默认：窥屏默认关、周期 10 分钟、人设与两个开关都在', () => {
    const cfg = readSource('../../assets/config.jsonc');
    assert.ok(/"peekPrompt":/.test(cfg), '默认人设必须在内置配置里');
    assert.ok(/"peekScreenEnabled": false/.test(cfg), '截图默认关（隐私默认最小）');
    assert.ok(/"peekPomodoroEnabled": true/.test(cfg), '番茄钟联动默认开');
    assert.ok(/"peek": 600/.test(cfg), '默认周期 600 秒');
    assert.ok(/"peekEnabled": false/.test(cfg), '宠物级窥屏默认关');
  });

  test('两端 UI 都能改：右键面板与 DSH 设置页', () => {
    const panel = readSource('../shared/productivity-panel.ts');
    assert.ok(/peekEnabled === true/.test(panel) && /pet\.peekEnabled = value/.test(panel), '面板必须有宠物级开关');
    assert.ok(/peekPrompt,/.test(panel), '面板必须提交人设');
    assert.ok(/eventsRefreshSec: \{ \.\.\.\(main\.eventsRefreshSec \?\? \{\}\), peek: peekIntervalSec \}/.test(panel));
    const settings = readSource('../client/settings.ts');
    assert.ok(/updateSel\(\{ peekEnabled: e\.target\.checked \}\)/.test(settings), '设置页也要有宠物级开关');
    assert.ok(/eventsRefreshSec: \{ \.\.\.refreshSec, peek: peekInterval \}/.test(settings), '设置页提交整段周期');
  });
});
