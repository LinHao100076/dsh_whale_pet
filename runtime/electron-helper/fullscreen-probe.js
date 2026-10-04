/**
 * dsh-pet-desktop desktop helper —— 「有应用全屏时隐藏桌宠」的 Win32 取数层。
 *
 * 这是本插件唯一一处 **FFI**（koffi，N-API 预编译二进制，Electron 43 免编译直接 require）：
 * Electron/Node 没有任何 API 能知道"别的应用全屏了"，只能问 Windows 自己。
 *
 * 取两个数（判定规则全在纯逻辑 fullscreen.js 里，本文件不做任何判断）：
 *   - SHQueryUserNotificationState()：shell 的"现在该不该弹通知"状态，2/3/4 = 有全屏应用/演示模式；
 *   - GetForegroundWindow() + GetWindowRect()：前台窗口矩形（**物理像素**），只用来定位"是哪块屏全屏"。
 *
 * 失败即降级（绝不拖垮 helper）：
 *   - 非 Windows / koffi 没装上 / DLL 或符号找不到 → createFullscreenProbe() 返回 null，
 *     调用方直接不启动轮询（功能静默不可用，只在 console 留一行原因）；
 *   - 单次查询抛错同样当成"查不到"（state=0 → 判定为不隐藏，绝不会因为一次异常把桌宠藏起来）。
 */

'use strict';

/** 诊断信息只打一次，避免 800ms 一次的轮询把日志刷爆 */
let warned = false;
function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.error('[dsh-pet-desktop-helper] fullscreen probe unavailable: ' + message);
}

/**
 * 建立 Win32 查询器。
 * @returns {{query: () => {state: number, rect: {x:number,y:number,width:number,height:number}|null}}|null}
 *   null = 本机不支持（非 Windows / koffi 缺失 / 符号加载失败）
 */
function createFullscreenProbe() {
  if (process.platform !== 'win32') return null; // 这套 shell 状态只有 Windows 有
  let koffi;
  try {
    koffi = require('koffi');
  } catch (e) {
    warnOnce('koffi not installed (' + String(e && e.message ? e.message : e) + ')');
    return null;
  }
  try {
    // 结构体必须先于引用它的函数原型声明；名字加前缀，避免与同进程其它 koffi 用户的 RECT 撞名。
    // 注意：koffi 的原型字符串按**注册名**解析类型，所以下面 GetWindowRect 的原型里写的是 DSHPD_RECT。
    const RECT = koffi.struct('DSHPD_RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const SHQueryUserNotificationState = shell32.func('int __stdcall SHQueryUserNotificationState(_Out_ int *pquns)');
    const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ DSHPD_RECT *rect)');

    return {
      /** 查一拍：state = SHQueryUserNotificationState；rect = 前台窗口矩形（物理像素），拿不到为 null */
      query() {
        const out = [0];
        SHQueryUserNotificationState(out);
        const state = Number(out[0]) || 0;
        let rect = null;
        const hwnd = GetForegroundWindow();
        if (hwnd) {
          const r = {};
          if (GetWindowRect(hwnd, r)) {
            rect = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
          }
        }
        return { state, rect };
      },
    };
  } catch (e) {
    warnOnce(String(e && e.message ? e.message : e));
    return null;
  }
}

module.exports = { createFullscreenProbe };
