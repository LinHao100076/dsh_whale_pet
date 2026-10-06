/**
 * 构建产物守卫：**产物里出现的每一个裸包名，都必须能在运行时被解析到**。
 *
 * 为什么值得单独一条测试（真实事故）：
 *   `lib/index.js` 曾经顶着三行
 *     import _x from "@oxc-project/runtime/helpers/classPrivateFieldInitSpec";
 *   这是 rolldown 把类私有字段（`#field`）降级到 es2020 时注入的**运行时助手**。
 *   那个包只是构建链的传递依赖、并不在 package.json 的 dependencies 里——
 *   平时它恰好躺在 node_modules 里所以看不出问题，一旦依赖树被重解析（npm install 别的包）它就消失，
 *   DSH 加载插件时直接 "failed to import"，整个插件启用失败（GUI 只给一句模糊提示）。
 *
 * 这条测试把"构建配置悄悄引入未声明运行时依赖"变成**测试阶段就能发现**的问题。
 * 它不读源码、只读产物——因为出问题的正是产物。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8');

/** DSH 宿主/浏览器在运行时**已经提供**的包（不由本插件的 dependencies 安装） */
const RUNTIME_PROVIDED = [/^@deepseek-ai\//, /^@electron\//, /^node:/, /^electron$/];

interface Pkg {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** 抽出产物里所有静态 import / 动态 import() / require() 的裸包名 */
function bareSpecifiers(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import x from "pkg" / export ... from "pkg"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // 动态 import("pkg")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("pkg")（client 侧外部依赖）
  ];
  for (const re of patterns) {
    for (const match of code.matchAll(re)) {
      const spec = match[1];
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('data:')) continue;
      found.add(spec);
    }
  }
  return [...found];
}

/** 取包名（含 scope）：@scope/name/sub → @scope/name；pkg/sub → pkg */
function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('构建产物守卫 —— 运行时可解析性', () => {
  const pkg = JSON.parse(read('package.json')) as Pkg;
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);

  for (const artifact of ['lib/index.js', 'lib/client.js']) {
    test(`${artifact}：不得导入未声明的包（否则 DSH 启用插件会 failed to import）`, () => {
      const code = read(artifact);
      const offenders = bareSpecifiers(code)
        .map(packageNameOf)
        .filter((name) => !RUNTIME_PROVIDED.some((re) => re.test(name)))
        .filter((name) => !declared.has(name));
      assert.deepEqual(
        [...new Set(offenders)],
        [],
        `${artifact} 导入了未在 dependencies/peerDependencies 声明的包：${[...new Set(offenders)].join(', ')}`,
      );
    });
  }

  test('产物里不得出现 @oxc-project/runtime（降级助手，见文件头的事故说明）', () => {
    for (const artifact of ['lib/index.js', 'lib/client.js']) {
      assert.ok(
        !read(artifact).includes('@oxc-project/runtime'),
        `${artifact} 又出现了降级助手：宿主 target 是不是被改回 es2020 了？`,
      );
    }
  });

  test('桌面渲染层产物（shared-core.js）同样不得依赖未声明的包', () => {
    const code = read('runtime/electron-helper/shared-core.js');
    const offenders = bareSpecifiers(code)
      .map(packageNameOf)
      .filter((name) => !RUNTIME_PROVIDED.some((re) => re.test(name)))
      .filter((name) => !declared.has(name));
    assert.deepEqual([...new Set(offenders)], []);
  });
});
