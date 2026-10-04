/**
 * dsh-pet-desktop desktop helper —— 「有应用全屏时隐藏桌宠」的纯判定。
 *
 * 分工（与 pointer-target.js 同一套路）：本文件只做纯计算——不 require('electron')、不摸 Win32，
 * 可被 node:test 直接加载单测；主进程侧只负责取数（fullscreen-probe.js 的 Win32 查询 +
 * screen 的显示器列表 + 每个窗口当前在哪块屏）与应用（win.hide() / win.show()）。
 *
 * 判据（Windows 实测）：
 *   - **主判据 = shell 的 SHQueryUserNotificationState**（"现在该不该弹通知"）：
 *       2 = QUNS_BUSY（有全屏应用在跑，或演示模式）、
 *       3 = QUNS_RUNNING_D3D_FULL_SCREEN（独占全屏的 D3D 应用 = 游戏）、
 *       4 = QUNS_PRESENTATION_MODE（演示模式）。
 *     实测：前台放一个无边框全屏窗口 → 2；关掉 → 回到 5（ACCEPTS_NOTIFICATIONS）。
 *     它是系统自己的判定，**最大化窗口不会触发**（实测仍为 5），所以正常办公时不会误藏桌宠。
 *   - 6（QUIET_TIME 勿扰时间）与 7（APP 沉浸式应用）**不参与判定**：前者与全屏无关，后者语义含混
 *     （"应用在跑"，未必全屏）。
 *   - **前台窗口矩形只用来定位是哪块屏全屏**，不参与"是不是全屏"的判定。理由：任务栏设为自动隐藏时，
 *     最大化窗口的矩形同样覆盖整屏；拿它当判据会在正常办公时把桌宠藏起来（宁可不触发，不可误触发）。
 *   - 拿不到前台窗口（全屏切换瞬间 GetForegroundWindow 可能返回 0）或矩形对不上任何屏（DPI 取整、
 *     跨屏全屏、虚拟屏）→ 视为"所有屏都全屏"：宁可多藏一会儿，也别在游戏画面上露脸。
 *
 * 坐标系：Win32 的 GetWindowRect 给的是**物理像素**，Electron 的 display.bounds 是 DIP。
 * 二者的关系 `physical = dip × scaleFactor` 在本 helper 的两种 DPI 模式下都成立
 * （默认用 --force-device-scale-factor=1 把所有屏塌缩成恒等映射，scaleFactor 报 1、DIP 即物理像素；
 * 用户用 DSH_PET_DESKTOP_FORCE_DSF=0 关掉强制时 scaleFactor 是真实值，同一公式仍成立），
 * 所以这里统一换算到**物理像素**再比较，与 DPI 开关无关。
 */

'use strict';

/** SHQueryUserNotificationState 的档位（Windows shell：现在该不该弹通知） */
const QUNS = {
  NOT_PRESENT: 1,
  /** 有全屏应用在跑，或处于演示模式 */
  BUSY: 2,
  /** 独占全屏的 D3D 应用（游戏） */
  RUNNING_D3D_FULL_SCREEN: 3,
  /** 演示模式（投影/连接外部显示器做汇报） */
  PRESENTATION_MODE: 4,
  /** 正常桌面：可以弹通知 */
  ACCEPTS_NOTIFICATIONS: 5,
  /** 勿扰时间（与全屏无关，不参与判定） */
  QUIET_TIME: 6,
  /** Win8 沉浸式应用（语义含混，不参与判定） */
  APP: 7,
};

/** 算「有东西全屏」的档位（系统自己的全屏语义） */
const FULLSCREEN_QUNS = [QUNS.BUSY, QUNS.RUNNING_D3D_FULL_SCREEN, QUNS.PRESENTATION_MODE];

/** 矩形覆盖判定的默认容差（物理像素）：全屏窗口偶尔比屏幕大几个像素，或差 1px 舍入 */
const RECT_TOLERANCE_PX = 4;

/** 轮询间隔（ms）：全屏切换是"人"的操作尺度，800ms 足够跟手，又把开销压到可忽略（单次查询 ~1ms） */
const FULLSCREEN_POLL_MS = 800;

/** 该档位是否意味着"有应用全屏"（主判据） */
function isFullscreenShellState(state) {
  return FULLSCREEN_QUNS.includes(Number(state));
}

/** Electron 显示器对象 → 物理像素矩形（physical = dip × scaleFactor；scaleFactor 缺失/非法按 1） */
function displayPhysicalBounds(display) {
  const b = display && display.bounds ? display.bounds : { x: 0, y: 0, width: 0, height: 0 };
  const s = Number(display && display.scaleFactor);
  const scale = Number.isFinite(s) && s > 0 ? s : 1;
  return { x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale };
}

/** rect 是否完整盖住 bounds（允许 tolerancePx 的容差） */
function rectCovers(rect, bounds, tolerancePx) {
  if (!rect || !bounds) return false;
  const t = Number.isFinite(tolerancePx) ? tolerancePx : RECT_TOLERANCE_PX;
  return (
    rect.x <= bounds.x + t &&
    rect.y <= bounds.y + t &&
    rect.x + rect.width >= bounds.x + bounds.width - t &&
    rect.y + rect.height >= bounds.y + bounds.height - t
  );
}

/** 被该矩形完整盖住的显示器 id 列表（跨屏全屏窗口可能同时盖住多块屏） */
function displayIdsCoveredBy(rect, displays, tolerancePx) {
  if (!rect || !Array.isArray(displays)) return [];
  return displays
    .filter((d) => rectCovers(rect, displayPhysicalBounds(d), tolerancePx))
    .map((d) => d && d.id)
    .filter((id) => Number.isFinite(id));
}

/**
 * 本轮该隐藏哪些屏上的桌宠。
 * @param {number} qunsState SHQueryUserNotificationState 的返回值
 * @param {{x:number,y:number,width:number,height:number}|null} foregroundRect 前台窗口矩形（物理像素）
 * @param {Array<{id:number,bounds:object,scaleFactor?:number}>} displays Electron 的显示器列表
 * @param {number} [tolerancePx]
 * @returns {number[]|null} 该隐藏的显示器 id；null = 不隐藏任何东西
 */
function resolveHiddenDisplayIds(qunsState, foregroundRect, displays, tolerancePx) {
  if (!isFullscreenShellState(qunsState)) return null;
  const list = Array.isArray(displays) ? displays : [];
  const covered = displayIdsCoveredBy(foregroundRect, list, tolerancePx);
  if (covered.length > 0) return covered;
  // 系统说有全屏，但定位不到具体哪块屏 → 全部隐藏（宁可多藏，不可在游戏上露脸）
  return list.map((d) => d && d.id).filter((id) => Number.isFinite(id));
}

/**
 * 每个窗口这一拍该隐藏还是该恢复（纯函数，主进程照单执行）。
 *
 * @param {Array<{id:number,displayId:number,visible:boolean,hiddenByUs:boolean,busy:boolean}>} windows
 *   visible      = win.isVisible()
 *   hiddenByUs   = 是否由本机制隐藏着（只恢复自己藏的窗口，绝不去 show 别人藏起来的窗口）
 *   busy         = 渲染端正拿着这个窗口的输入（拖拽中 / 右键菜单 / 对话弹窗 / 配置面板开着）。
 *                  这种情况**绝不藏**：窗口一藏，拖拽的 pointerup 就再也收不到（宠物永远停在
 *                  "拖拽中"，恢复后还跟着光标跑）；面板开着同理（用户正在配置）。关掉后下一拍自然生效。
 * @param {number[]|null} hiddenDisplayIds resolveHiddenDisplayIds 的结果
 * @returns {{hide:number[], show:number[]}}
 */
function planFullscreenWindows(windows, hiddenDisplayIds) {
  const covered = new Set(Array.isArray(hiddenDisplayIds) ? hiddenDisplayIds : []);
  const hide = [];
  const show = [];
  for (const w of Array.isArray(windows) ? windows : []) {
    if (!w || !Number.isFinite(w.id)) continue;
    const shouldHide = covered.has(w.displayId);
    if (shouldHide) {
      // 用户正在用这个窗口 → 这一拍不动它（不加入 hide，也不记账：放开后下一拍就藏）
      if (w.visible && !w.hiddenByUs && !w.busy) hide.push(w.id);
    } else if (w.hiddenByUs) {
      show.push(w.id);
    }
  }
  return { hide, show };
}

module.exports = {
  QUNS,
  FULLSCREEN_QUNS,
  RECT_TOLERANCE_PX,
  FULLSCREEN_POLL_MS,
  isFullscreenShellState,
  displayPhysicalBounds,
  rectCovers,
  displayIdsCoveredBy,
  resolveHiddenDisplayIds,
  planFullscreenWindows,
};
