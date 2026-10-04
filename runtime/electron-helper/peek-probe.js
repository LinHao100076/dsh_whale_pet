/**
 * dsh-pet-desktop desktop helper —— 窥屏吐槽的「前台窗口情报」取数层（Win32）。
 *
 * 只回答三个问题（判定/拼提示词全在 host 的 peek.ts 里，本文件不做任何判断）：
 *   - 前台窗口标题是什么（GetForegroundWindow + GetWindowTextW，宽字符版：中文标题不能走 ANSI）；
 *   - 那个窗口属于哪个可执行文件（GetWindowThreadProcessId → OpenProcess + QueryFullProcessImageNameW，
 *     只取文件名，不带路径——路径里常有用户名，没必要给模型看）；
 *   - 主人多久没动键鼠了（GetLastInputInfo + GetTickCount）。
 *
 * **不截屏**：截图在 main.js 里走 Electron 的 desktopCapturer（那是 Electron 的能力，不需要 FFI）。
 *
 * 失败即降级：koffi 缺失 / 非 Windows / 某个 API 取不到 → 对应字段省略（context 里没有这个键），
 * 调用方照样能把剩下的情报交给模型；整条链路绝不因为"查窗口标题失败"而中断。
 */

'use strict';

/** 进程查询权限（Vista+ 的最小权限，够 QueryFullProcessImageNameW 用） */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** 窗口标题上限（UTF-16 码元）；超长的标题截断即可，模型不需要全文 */
const TITLE_CHARS = 256;
/** 进程路径缓冲（UTF-16 码元） */
const PATH_CHARS = 512;

let warned = false;
function warnOnce(message) {
  if (warned) return;
  warned = true;
  console.error('[dsh-pet-desktop-helper] peek probe unavailable: ' + message);
}

/**
 * 建立前台窗口情报查询器。
 * @returns {{context: () => {windowTitle?: string, processName?: string, idleSeconds?: number}}|null}
 *   null = 本机不支持（非 Windows / koffi 缺失 / DLL 或符号加载失败）
 */
function createPeekProbe() {
  if (process.platform !== 'win32') return null; // Win32 专有
  let koffi;
  try {
    koffi = require('koffi');
  } catch (e) {
    warnOnce('koffi not installed (' + String(e && e.message ? e.message : e) + ')');
    return null;
  }
  try {
    const LASTINPUTINFO = koffi.struct('DSHPD_LASTINPUTINFO', { cbSize: 'uint', dwTime: 'uint32' });
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
    const GetWindowTextW = user32.func(
      'int __stdcall GetWindowTextW(void *hWnd, _Out_ char16_t *lpString, int nMaxCount)',
    );
    const GetWindowThreadProcessId = user32.func(
      'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)',
    );
    const GetLastInputInfo = user32.func('bool __stdcall GetLastInputInfo(_Inout_ DSHPD_LASTINPUTINFO *plii)');
    const GetTickCount = kernel32.func('uint32 __stdcall GetTickCount()');
    const OpenProcess = kernel32.func(
      'void * __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)',
    );
    const QueryFullProcessImageNameW = kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32 *lpdwSize)',
    );
    const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
    const GetCurrentProcessId = kernel32.func('uint32 __stdcall GetCurrentProcessId()');
    /** 本进程 pid：桌宠窗口自己也可能是前台窗口（可聚焦 + alwaysOnTop，用户刚点过它就会抢到焦点）。
     *  那种情况下情报是"你正在看桌宠"，属于噪音——直接当成"没看到前台窗口"，别让模型拿它编段子。 */
    const SELF_PID = GetCurrentProcessId();

    /** 窗口所属进程 pid（拿不到 → 0） */
    const windowPid = (hwnd) => {
      try {
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        return Number(pid[0]) || 0;
      } catch {
        return 0;
      }
    };

    /** 宽字符缓冲 → JS 字符串（len 为码元数；0 表示没有文本） */
    const decodeWide = (buf, len) => {
      const n = Number(len) || 0;
      if (n <= 0) return '';
      try {
        return koffi.decode(buf, 'char16_t', n);
      } catch {
        return '';
      }
    };

    /** 窗口标题（拿不到 → 空串） */
    const windowTitle = (hwnd) => {
      try {
        const buf = Buffer.alloc(TITLE_CHARS * 2);
        return decodeWide(buf, GetWindowTextW(hwnd, buf, TITLE_CHARS)).trim();
      } catch {
        return '';
      }
    };

    /** 前台窗口所属进程的可执行文件名（拿不到 → 空串） */
    const processName = (hwnd) => {
      let handle = null;
      try {
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        if (!pid[0]) return '';
        handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
        if (!handle) return '';
        const buf = Buffer.alloc(PATH_CHARS * 2);
        const size = [PATH_CHARS];
        if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return '';
        const full = decodeWide(buf, size[0]);
        if (!full) return '';
        const parts = full.split(/[\\/]/);
        return (parts[parts.length - 1] || '').trim();
      } catch {
        return '';
      } finally {
        if (handle) {
          try {
            CloseHandle(handle);
          } catch {
            /* 关句柄失败无所谓：进程即将长期持有这一份，下一拍还会再开一个 */
          }
        }
      }
    };

    /** 空闲秒数（GetLastInputInfo 给的是"最后一次输入时的 tick"，做差即可） */
    const idleSeconds = () => {
      try {
        const info = { cbSize: koffi.sizeof(LASTINPUTINFO) };
        if (!GetLastInputInfo(info)) return undefined;
        const elapsed = (GetTickCount() - Number(info.dwTime)) >>> 0; // uint32 回绕也成立
        return Math.round(elapsed / 1000);
      } catch {
        return undefined;
      }
    };

    return {
      /** 取一拍情报：拿不到的字段直接省略（调用方按"没看到"处理） */
      context() {
        const out = {};
        const hwnd = GetForegroundWindow();
        if (hwnd && windowPid(hwnd) !== SELF_PID) {
          // 只报告**别的进程**的前台窗口：本进程窗口（桌宠自己）当没看见，见 SELF_PID 注释
          const title = windowTitle(hwnd);
          const proc = processName(hwnd);
          if (title) out.windowTitle = title;
          if (proc) out.processName = proc;
        }
        const idle = idleSeconds();
        if (Number.isFinite(idle)) out.idleSeconds = idle;
        return out;
      },
    };
  } catch (e) {
    warnOnce(String(e && e.message ? e.message : e));
    return null;
  }
}

module.exports = { createPeekProbe, TITLE_CHARS, PATH_CHARS };
