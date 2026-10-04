/**
 * 「需要你做决定」提醒音的测试：文件名解析、认领队列、客户端判定、源码接线。
 *
 * 背景：DSH 出现需要用户拍板的事（approval/asked、ask_user_question、turn/end blocked）时，
 * 桌宠播一段音频提醒。多宠物窗口 + 浏览器页面可能同时在线，所以宿主只放**一条全局待播提醒**，
 * 各端轮询后认领——先到先得，只有认领成功的那个客户端才播（避免合唱）。
 *
 * 本文件钉住：
 *   ① 文件名只允许"单层文件名 + 白名单扩展名"（配置值会进 URL 与文件系统路径）；
 *   ② 素材解析顺序：用户 main-sound/ 优先 → 包内 assets/sound/ 兜底；
 *   ③ 认领语义：去抖、TTL、先到先得、认领失败不重复认领；
 *   ④ 客户端判定：不开启/没文件/同一条已处理过 → 什么都不做；
 *   ⑤ 源码守卫：宿主在 waiting 时入队、两条端点、资源路由、两端客户端都真的播。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clampSfxVolume,
  DEFAULT_SFX_FILE,
  isSoundFileName,
  sfxAssetUrl,
  sfxCueAction,
  sfxPollDelayMs,
  soundMime,
  SFX_POLL_IDLE_MS,
  SFX_POLL_MS,
  type SfxState,
} from '../shared/sfx.ts';
import { CueStore, resolveSoundFile, sfxState } from './sfx.ts';

/** 包内文件源码（守卫用；相对 src/host/ 解析） */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('音频文件名白名单（配置值会进 URL 与文件路径，必须只允许单层文件名）', () => {
  test('正常文件名（含中文）通过', () => {
    for (const name of ['need-decision.mp3', '在吗.mp3', 'ding.WAV', 'a b.ogg', 'cue.m4a', 'x.flac']) {
      assert.equal(isSoundFileName(name), true, name);
    }
  });

  test('路径分隔符 / 上级目录 / 保留字符 / 不支持扩展名一律拒', () => {
    for (const name of [
      '../x.mp3',
      'a/b.mp3',
      'a\\b.mp3',
      '..',
      '.',
      'x.exe',
      'x.txt',
      'x',
      '.mp3',
      '',
      '   ',
      'x\u0000.mp3',
      'x<>.mp3',
      'x:y.mp3',
      'a'.repeat(200) + '.mp3',
    ]) {
      assert.equal(isSoundFileName(name), false, JSON.stringify(name));
    }
    assert.equal(isSoundFileName(42), false);
    assert.equal(isSoundFileName(null), false);
  });

  test('MIME：白名单内的扩展名给音频类型，未知给二进制流', () => {
    assert.equal(soundMime('a.mp3'), 'audio/mpeg');
    assert.equal(soundMime('在吗.WAV'), 'audio/wav');
    assert.equal(soundMime('a.ogg'), 'audio/ogg');
    assert.equal(soundMime('a.m4a'), 'audio/mp4');
    assert.equal(soundMime('a.unknown'), 'application/octet-stream');
  });
});

describe('resolveSoundFile —— 用户目录优先，包内兜底（找不到就安静地不播）', () => {
  function fixture(): { paths: { userRoot: string; packageRoot: string }; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sfx-'));
    const userRoot = join(dir, 'user');
    const packageRoot = join(dir, 'pkg');
    mkdirSync(join(userRoot, 'main-sound'), { recursive: true });
    mkdirSync(join(packageRoot, 'assets', 'sound'), { recursive: true });
    return { paths: { userRoot, packageRoot }, dir };
  }

  test('两处都有 → 用户目录优先', () => {
    const { paths, dir } = fixture();
    try {
      writeFileSync(join(paths.userRoot, 'main-sound', 'a.mp3'), 'user');
      writeFileSync(join(paths.packageRoot, 'assets', 'sound', 'a.mp3'), 'pkg');
      assert.equal(resolveSoundFile(paths, 'a.mp3'), join(paths.userRoot, 'main-sound', 'a.mp3'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('只有包内有 → 用包内', () => {
    const { paths, dir } = fixture();
    try {
      writeFileSync(join(paths.packageRoot, 'assets', 'sound', 'b.mp3'), 'pkg');
      assert.equal(resolveSoundFile(paths, 'b.mp3'), join(paths.packageRoot, 'assets', 'sound', 'b.mp3'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('都没有 / 文件名非法 → undefined（绝不拼出穿越路径）', () => {
    const { paths, dir } = fixture();
    try {
      assert.equal(resolveSoundFile(paths, 'missing.mp3'), undefined);
      assert.equal(resolveSoundFile(paths, '../../etc/passwd'), undefined);
      assert.equal(resolveSoundFile(paths, 'evil.exe'), undefined);
      assert.equal(resolveSoundFile(paths, DEFAULT_SFX_FILE), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CueStore —— 全局认领式提醒队列（多端只响一次）', () => {
  test('fire → pending 可见；认领成功后清空', () => {
    const now = 1_000;
    const store = new CueStore({ now: () => now });
    assert.equal(store.pending(), null);
    const cue = store.fire();
    assert.ok(cue && cue.id);
    assert.deepEqual(store.pending(), { id: cue.id, ts: cue.ts });
    assert.equal(store.claim(cue.id), true, '先到者拿到 true');
    assert.equal(store.pending(), null, '认领后清空');
    assert.equal(store.claim(cue.id), false, '同一个 id 不能被认领两次（避免合唱）');
  });

  test('认领要求 id 完全匹配（错 id / 非字符串一律 false）', () => {
    const now = 1_000;
    const store = new CueStore({ now: () => now });
    const cue = store.fire();
    assert.equal(store.claim('nope'), false);
    assert.equal(store.claim(undefined), false);
    assert.equal(store.claim(123), false);
    assert.equal(store.pending()?.id, cue?.id, '错 id 不得清掉待播提醒');
  });

  test('去抖：最小间隔内的连续上报不产生新提醒（同一批工具连续申请权限）', () => {
    let now = 1_000;
    const store = new CueStore({ now: () => now, minGapMs: 3_000 });
    assert.ok(store.fire());
    now = 1_500;
    assert.equal(store.fire(), null, '1.5s 内的第二次被挡掉');
    now = 4_500;
    assert.ok(store.fire(), '过了最小间隔就是新的一次决策');
  });

  test('TTL：太久没人认领就作废（离开一会儿回来不该为五分钟前的事响）', () => {
    let now = 1_000;
    const store = new CueStore({ now: () => now, ttlMs: 10_000 });
    const cue = store.fire();
    now = 1_000 + 10_001;
    assert.equal(store.pending(), null, '过期即不可见');
    assert.equal(store.claim(cue?.id), false, '过期后也不能认领');
  });
});

describe('sfxState —— GET /sfx 的响应组装', () => {
  test('开关关掉：不给 url、不给 pending、也不报 missing', () => {
    const out = sfxState({
      enabled: false,
      volume: 0.5,
      file: 'a.mp3',
      url: '/sound/a.mp3',
      hasFile: true,
      pending: { id: 'c1', ts: 1 },
    });
    assert.equal(out.enabled, false);
    assert.equal(out.url, null);
    assert.equal(out.pending, null);
    assert.equal(out.missing, undefined);
  });

  test('开启但文件缺失：missing=true 且不给 pending（保持安静）', () => {
    const out = sfxState({
      enabled: true,
      volume: 0.5,
      file: 'a.mp3',
      url: null,
      hasFile: false,
      pending: { id: 'c1', ts: 1 },
    });
    assert.equal(out.missing, true);
    assert.equal(out.pending, null);
    assert.equal(out.url, null);
  });

  test('开启且有文件：url 与 pending 原样给出，音量夹取', () => {
    const out = sfxState({
      enabled: true,
      volume: 9,
      file: 'a.mp3',
      url: '/sound/a.mp3',
      hasFile: true,
      pending: { id: 'c1', ts: 1 },
    });
    assert.equal(out.url, '/sound/a.mp3');
    assert.deepEqual(out.pending, { id: 'c1', ts: 1 });
    assert.equal(out.volume, 1, '越界音量夹到 1');
    assert.equal(out.missing, undefined);
  });
});

describe('客户端判定（两端共用同一份纯逻辑）', () => {
  const base: SfxState = { ok: true, enabled: true, volume: 0.8, url: '/sound/a.mp3', pending: { id: 'c1', ts: 1 } };

  test('开关关 / 没音频 / 响应非法 → 什么都不做', () => {
    assert.equal(sfxCueAction('', null), 'none');
    assert.equal(sfxCueAction('', { ...base, enabled: false }), 'none');
    assert.equal(sfxCueAction('', { ...base, url: null }), 'none');
    assert.equal(sfxCueAction('', { ...base, pending: null }), 'none');
  });

  test('新提醒 → 认领；同一条已处理过 → 不再认领（避免每秒重复请求）', () => {
    assert.equal(sfxCueAction('', base), 'claim');
    assert.equal(sfxCueAction('c1', base), 'none');
    assert.equal(sfxCueAction('c1', { ...base, pending: { id: 'c2', ts: 2 } }), 'claim');
  });

  test('轮询间隔：开启 1s、关闭 10s', () => {
    assert.equal(sfxPollDelayMs(true), SFX_POLL_MS);
    assert.equal(sfxPollDelayMs(false), SFX_POLL_IDLE_MS);
  });

  test('音量夹取：非法回落到默认，越界夹到边界', () => {
    assert.equal(clampSfxVolume(0.5), 0.5);
    assert.equal(clampSfxVolume(-1), 0);
    assert.equal(clampSfxVolume(2), 1);
    assert.equal(clampSfxVolume('loud', 0.8), 0.8);
    assert.equal(clampSfxVolume(undefined, 0.8), 0.8);
  });

  test('地址拼接：宿主给的是去前缀路径，两端各自接自己的基址', () => {
    assert.equal(sfxAssetUrl('/dsh-pet-desktop-7340', '/sound/在吗.mp3'), '/dsh-pet-desktop-7340/sound/在吗.mp3');
    assert.equal(
      sfxAssetUrl('dsh-pet-desktop-bridge://dsh-pet-desktop/dsh-pet-desktop-7340', '/sound/a.mp3'),
      'dsh-pet-desktop-bridge://dsh-pet-desktop/dsh-pet-desktop-7340/sound/a.mp3',
    );
    assert.equal(sfxAssetUrl('/x', null), null);
  });
});

describe('源码守卫 —— 接线（宿主入队 / 两条端点 / 资源路由 / 两端都真的播）', () => {
  const host = readSource('../host/index.ts');
  const config = readSource('../host/config.ts');
  const cfg = readSource('../../assets/config.jsonc');
  const events = readSource('../../runtime/electron-helper/events.js');
  const sprite = readSource('../../runtime/electron-helper/sprite.js');
  const constants = readSource('../../runtime/electron-helper/constants.js');
  const pet = readSource('../client/pet.ts');

  test('宿主在"等你拍板"时入队（waiting 三个来源全覆盖）', () => {
    assert.ok(/if \(next === 'waiting'\) sfxCues\.fire\(\);/.test(host), 'waiting 时必须入队');
    assert.ok(/const sfxCues = new CueStore\(\)/.test(host), '必须有一颗全局队列实例');
    assert.ok(
      /if \(next === 'waiting'\) sfxCues\.fire\(\);[\s\S]{0,200}?const seq = /.test(host),
      '入队必须在 setState 去重**之前**（同一会话连续两次决策各响一次）',
    );
  });

  test('两条端点：GET /sfx 状态 + POST /sfx/claim 认领（只 POST）', () => {
    assert.ok(/if \(rest === 'sfx'\) \{/.test(host), '必须有 /sfx');
    assert.ok(/if \(rest === 'sfx\/claim'\) \{/.test(host), '必须有 /sfx/claim');
    assert.ok(
      /if \(rest === 'sfx\/claim'\) \{\s*if \(method !== 'POST'\) return \{ kind: 'json', status: 405/.test(host),
      '认领只接受 POST',
    );
    assert.ok(/play: sfxCues\.claim\(id\)/.test(host), '认领结果原样返回 play');
  });

  test('资源路由：/sound/<file> 走用户目录优先 + 包内兜底，MIME 按扩展名', () => {
    assert.ok(/if \(scope === 'sound'\) \{/.test(host), '必须有 /sound/<file> 路由');
    assert.ok(/resolveSoundFile\(\{ userRoot, packageRoot: PACKAGE_ROOT \}, name\)/.test(host));
    assert.ok(/contentType: soundMime\(name\)/.test(host));
    assert.ok(
      /url:[\s\S]{0,200}?`\/sound\/\$\{encodeURIComponent\(setting\.file\)\}`/.test(host),
      'url 去前缀（两端各自拼基址）',
    );
  });

  test('配置三件套：读取侧校验 + 保存侧白名单（UI 才改得动）', () => {
    assert.ok(
      /case 'sfxEnabled':/.test(config) && /case 'sfxVolume':/.test(config) && /case 'sfxDecision':/.test(config),
    );
    assert.ok(/if \(sfe !== undefined\) outConfig\.sfxEnabled = sfe;/.test(config));
    assert.ok(/if \(sfd !== undefined\) bodyOwned\.add\('sfxDecision'\);/.test(config));
    assert.ok(
      /"sfxEnabled": true/.test(cfg) &&
        /"sfxVolume": 0\.8/.test(cfg) &&
        /"sfxDecision": "need-decision\.mp3"/.test(cfg),
    );
    assert.ok(/main-sound\//.test(cfg), '内置配置的注释必须写清音频放哪');
  });

  test('桌面端：轮询 → 认领 → playCue；音频独立于动画（被全屏隐藏/暂停也要能响）', () => {
    assert.ok(/PetSprite\.prototype\.startSfxLoop/.test(events), '必须有提醒音循环');
    assert.ok(/S\.sfxCueAction\(lastHandled, state\)/.test(events), '判定走 shared 纯函数');
    assert.ok(/S\.sfxAssetUrl\(BASE, state\.url\)/.test(events), '地址接到桌面基址上');
    assert.ok(/out\.play === true/.test(events), '只有认领成功才播');
    assert.ok(/for \(const s of sprites\) s\.startSfxLoop\(\)/.test(events), 'startLoops 必须挂上');
    assert.ok(/const SFX_URL = BASE \+ '\/sfx'/.test(constants), '端点常量与宿主路由一致');
    assert.ok(/playCue\(url, volume\)/.test(sprite), 'sprite 必须有播放方法');
    assert.ok(/this\.sfxAudio = new Audio\(\)/.test(sprite), '用独立的 Audio（不复用宠物 video）');
    assert.ok(/window\.clearTimeout\(this\.sfxLoopTimer\)/.test(sprite), 'dispose 必须清掉循环');
  });

  test('浏览器端：容器级单循环（不是每只宠物一个）', () => {
    assert.ok(/fetch\('\/dsh-pet-desktop-7340\/sfx'/.test(pet), '浏览器必须轮询 /sfx');
    assert.ok(/sfxAssetUrl\('\/dsh-pet-desktop-7340', state\.url\)/.test(pet), '地址接同源前缀');
    assert.ok(/sfxCueAction\(lastHandled, state\)/.test(pet), '判定与桌面同一份纯逻辑');
    assert.ok(/out\?\.play === true && audio/.test(pet), '只有认领成功才播');
  });
});
