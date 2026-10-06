// tsdown 配置（仿官方 DSH 客户端插件的构建方式：src → lib 产物）
// 说明：DSH 浏览器插件生产出的 lib/client.js 必须是
//       window.__ModuleLoader__.load({ id, factory }) 单文件形态；
//       react / react/jsx-runtime / @deepseek-ai/* 保持外部 require（不打包）。
import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    format: ['esm'],
    platform: 'node',
    // 宿主半侧跑在 DSH 的 Node（20+）里，**不要**按 es2020 降级：
    // 降级类私有字段（#field）会让 rolldown 注入 `@oxc-project/runtime/helpers/...` 的 import，
    // 而那个包只是构建链的传递依赖、并不在 package.json 的 dependencies 里——
    // 依赖树一被重解析（比如 npm install 别的包）它就可能消失，插件随即"failed to import"。
    // 真实踩过：lib/index.js 顶着三行 @oxc-project/runtime 的 import，宿主直接起不来。
    target: 'es2022',
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
    dts: false,
    outDir: 'lib',
    clean: false,
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
    dts: false,
    outDir: 'lib',
    clean: false,
  },
]);
