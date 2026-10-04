# dsh-pet-desktop 🐟

> **桌面宠物 + 番茄钟 / Todo / 窥屏吐槽** —— [DeepSeek Harness](https://github.com/topics/dsh-plugin)（DSH）插件
>
> 一只浮在桌面上的 Q 版小女仆：会待机、会跑、能被拖着甩出去，会碎碎念、会窥屏吐槽你，
> 会跟着 DSH 的工作状态切动画，会在你需要拍板时喊你一声。

<p align="left">
  <img src="assets/preview/daiji-huxi-xiuxian.gif" alt="待机" width="200" />
  <img src="assets/preview/beishubiao-tuozhuai-xuankong-fankui.gif" alt="被鼠标拖拽悬空" width="200" />
  <img src="assets/preview/gongzuozhuangtai-sikao-maopao.gif" alt="工作状态-思考冒泡" width="200" />
  <img src="assets/preview/xie-daima.gif" alt="写代码" width="200" />
</p>

> 预览图在仓库的 `assets/preview/`（约 100 张 GIF，**不随 npm 包发布**，只作展示）。
> 动画本体是 VP9-alpha 的 `.webm`，两端共用。

---

## 目录

- [特性一览](#特性一览)
- [安装](#安装)
- [快速上手](#快速上手)
- [功能详解](#功能详解)
- [配置](#配置)
- [自定义素材（动画 / 音频 / 字体 / 表情包）](#自定义素材)
- [存储位置与卸载](#存储位置与卸载)
- [开发](#开发)
- [平台支持与已知限制](#平台支持与已知限制)
- [English Quick Start](#english-quick-start)
- [License](#license)

---

## 特性一览

| 分类              | 能力                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐟 **本体**       | 透明置顶局部小窗（**多显示器**可用、可跨屏飞行）、多实例（`pets[]` 每只一个窗口）、浏览器 overlay 同一只宠物（`display: web/desktop/both/none`）                |
| 🖱️ **互动**       | 点击回应动画、按住拖拽（弹簧跟手）、**甩出去会抛掷反弹**（重力/弹性/摩擦/力度可调）、宠物互撞、**甩得越快分数越高**（分数弹窗 + 粒子）                          |
| 💬 **AI 互动**    | **碎碎念**（按周期随口一句，人设/配图/周期可配）、**对话**（带记忆，右键弹窗输入）、**窥屏吐槽**（偷看一眼你在干嘛再吐槽，可联动番茄钟、可选截图）              |
| 🍅 **陪伴与效率** | **番茄钟 + Todo**（面板内计时、任务清单、拖动排序、关联任务）、**余额气泡**（服务商余额/用量）、**工作状态联动**（跟着 DSH 思考/干活/等你确认/完成/出错切动画） |
| 🔔 **提醒**       | **「需要你做决定」提醒音**（权限申请 / 模型提问 / 回合阻塞时响一声，音频自备）、系统通知（窗口失焦时弹桌面通知）                                                |
| 🧠 **智能行为**   | **全屏时自动隐藏**（玩游戏/看视频不挡画面，多屏只藏被覆盖那块屏）、回到初始位置、改了配置一键重载                                                               |
| 🎛️ **可配置**     | 右键「配置桌宠」气泡面板 + DSH 设置页，两处都能改；**人设提示词**（碎碎念 / 窥屏各一份）可直接在 UI 里写；其余高级字段改 JSONC 配置文件                         |

---

## 安装

### 1. 从插件市场安装（推荐）

DSH 里装好 [DSH Plugin Hub](https://dsh-plugin.org)（`dsh-plugin`）后：
**设置 → 插件市场 → 搜索 `dsh-pet-desktop`**，或走「自定义安装」按 NPM 包名安装。装完刷新页面即生效。

### 2. 命令行安装

```bash
dsh plugin add dsh-pet-desktop            # 必要时补 --profile <你的 profile 名>
```

### 3. 本地目录（开发 / 自用）

在 profile 的 `package.json` 里用 `link:` 指向本仓库，并把插件加进 bundle 层：

```jsonc
{
  "dependencies": { "dsh-pet-desktop": "link:D:/path/to/dsh-pet-desktop" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-pet-desktop"] } },
}
```

改完源码后**必须重新构建**（见 [开发](#开发)），否则 `lib/` 与 `runtime/electron-helper/shared-core.js` 仍是旧的。

### 首次启动

- 浏览器 overlay：立即可用。
- **桌面模式**首次启动会自动下载 Electron 运行时到 `$DSH_HOME/electron`（默认 `~/.dsh/electron`，约 100MB、走 npmmirror 镜像）。
  内网/离线：设 `DSH_PET_DESKTOP_ELECTRON_MIRROR`（镜像）或 `DSH_PET_DESKTOP_ELECTRON_PATH`（现成 exe 路径）。

---

## 快速上手

1. **右键桌宠** → 弹出级联菜单（所有能力都在这里）：

   | 菜单项            | 作用                                               |
   | ----------------- | -------------------------------------------------- |
   | 打开网站          | 用系统默认浏览器打开 DSH                           |
   | 查看余额          | 立即拉取并弹余额气泡（仅该宠物开了余额功能时显示） |
   | 碎碎念            | 立刻生成一句（绕过节流）                           |
   | 窥屏吐槽          | 立刻看一眼你在干嘛并吐槽一句                       |
   | 对话              | 弹出输入框，回车发送，回复用气泡显示               |
   | 回到初始位置      | 停漫游/移动，回配置的角落                          |
   | 重载配置          | 改完配置文件不用回设置页：重启桌面宠物窗口         |
   | **配置桌宠**      | 打开配置面板（气泡样式）                           |
   | **番茄钟与 Todo** | 打开计时与任务面板                                 |
   | 动作              | 三级菜单：按分类点播任意动画（可当预览用）         |

2. **设置页**：DSH「设置 → 桌宠配置」，宠物列表 / 全局开关 / 物理 / 窥屏 / 提醒音 / 高级配置路径 / 卸载说明。
3. **斜杠命令**：`/balance`（立即显示余额）、`/pet`（选择当前桌宠，支持选择框）、`/chat`（与桌宠对话，留空 = 碎碎念一句）。

---

## 功能详解

### 🐟 本体与互动

- **透明置顶小窗**：每只宠物一个局部窗口（不是全屏透明画布），点击穿透——只有宠物身体能点到，其余区域不挡下层应用。
  只有「兜底通道」在 Windows 鼠标钩子失效时按真实光标位置独立判定，保证永远拖得动。
- **拖拽抛掷**：弹簧跟手 → 松手按指针轨迹估速 → 抛物线飞行 + 碰壁/落地反弹；参数（`physics`）可在 UI 里调，
  默认 `gravity 1400 / restitution 0.78 / groundFriction 2.5 / throwPower 1`。
- **多显示器**：可被拖/甩到任意一块屏；`confineToScreen: true` 时屏缝当墙，不飞到隔壁屏。
- **点击积分**：拖拽抓取速度 ≥ 400px/s 才计分，分数 =（速度/100）×（基准宽度/宠物宽度）——**甩得越快、宠物越小分越高**；
  弹 `+N` 分数弹窗 + 粒子爆发。
- **随机动作链**：待机/转向/移动/分类池按权重随机；带文字的动作在镜像朝向时不会被选中（避免文字颠倒）。

### 💬 碎碎念 / 对话 / 窥屏

| 功能         | 触发                                                    | 人设            | 说明                                                                         |
| ------------ | ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| **碎碎念**   | 按 `eventsRefreshSec.whisper`（默认 300s）周期          | `whisperPrompt` | 每次生成都会调用当前对话模型；可选从表情包池随机配图                         |
| **对话**     | 右键「对话」或 `/chat`                                  | 同上 + 你的名字 | 记忆存 `memory.json`（全存不删），每次请求截尾 `chatMemoryRounds` 轮进上下文 |
| **窥屏吐槽** | 按 `eventsRefreshSec.peek`（默认 600s）周期，**默认关** | `peekPrompt`    | 情报 = 前台窗口标题 + 进程名 + 空闲时长；可选真截图；可联动番茄钟            |

**窥屏的两种素材档**：

1. **窗口情报**（任何文本模型都能用）：`GetForegroundWindow/GetWindowTextW/QueryFullProcessImageName/GetLastInputInfo`，
   只上传几十个字符，**画面不出本机**。
2. **真截图**（需多模态模型）：Electron `desktopCapturer` 抓光标所在那块屏 → 1280×720 JPEG q60（约 60KB）。
   能力判定：模型声明支持图片 → 发；**显式不支持 → 跳过**（并一次性提示）；元数据未知 → 先试一次，失败**自动退回纯情报**。
   > 截图会随请求发给模型服务商；介意隐私就别开。

**番茄钟联动**：专注阶段把「阶段/剩余时间/关联任务」写进情报 → 宠物换成督促语气、发现你在看社交/视频/游戏类窗口直接点名；
休息阶段改为放松调侃。摸鱼判断交给模型（情报里有进程名与窗口标题）。

### 🍅 番茄钟与 Todo

- 默认 25 / 5 / 15 分钟、每 4 轮长休息；`settings.showBubble` 打开时宠物气泡会显示计时状态。
- 任务清单支持预计番茄数、完成勾选、拖动排序、关联到某个任务计时；完成的番茄数会累加到任务上。
- 计时在**宿主**里跑（浏览器与桌面共享同一份权威状态），存在 `productivity.json`。
- 面板是「气泡框」样式，与配置面板同一套观感。

### 🔔 提醒

**「需要你做决定」提醒音**（`sfxEnabled`，默认开，但**没有音频文件时完全安静**）：

- 触发：`approval/asked`（权限申请）、`tool/call ask_user_question`（模型在等你回答）、`turn/end blocked`（回合被阻塞）。
- 多端只响**一次**：宿主放一条全局待播提醒（TTL 60s、最小间隔 3s），各端轮询后**认领**，先到先得。
- 音频放 `~/.dsh/dsh-pet-desktop/main-sound/<文件名>`（优先）或包内 `assets/sound/`；
  支持 `mp3 / wav / ogg / oga / m4a / aac / opus / flac / webm`；文件名只允许单层文件名。
- 不受「全屏时隐藏桌宠」影响——你在游戏里正是最需要它的时候。

**系统通知**（`notificationsEnabled`）：对话完成 / 生成失败 / 输出截断 / 权限申请 / 用户选择，在窗口失焦时弹桌面通知。

### 🧠 全屏时自动隐藏（Windows）

- 判定用 Windows 自己的 `SHQueryUserNotificationState`（2/3/4 = 有全屏应用或演示模式）：
  **最大化窗口不会误触发**，正常办公不会误藏。
- 前台窗口矩形只用来定位是**哪块屏**，不参与"是不是全屏"的判定（任务栏自动隐藏时，最大化窗口的矩形同样覆盖整屏）。
- 多屏：只隐藏被全屏覆盖那块屏上的宠物，另一块屏照常活动；打开配置面板时不隐藏。
- 隐藏期间渲染端会**悬挂**（停漫游/抛掷 + 暂停视频解码），不白烧 CPU。

---

## 配置

### 三层合并（后者覆盖前者）

| 层       | 位置                                          | 说明                                                                       |
| -------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| 内置默认 | 包内 `assets/config.jsonc`                    | **唯一默认值来源**，含全部中文注释，可作为完整参考                         |
| 用户层   | `~/.dsh/dsh-pet-desktop/main-config.jsonc`    | 设置页保存的就是它（JSONC，允许注释）；只写你想改的字段                    |
| 文件宠物 | `~/.dsh/dsh-pet-desktop/pet/<名>-config.json` | 一个文件一个条目（可覆盖任意顶层字段），配套素材目录 `pet/<名>-animation/` |

规则：**没写 → 静默取内置默认；显式写了但非法 → 告警一次并回退默认**（绝不返回残缺值）。
设置页「保存」是白名单重建，**未提交的手改字段会原样透传保留**（不会把你精调的 `animations`/`memes` 抹掉）。

### 常用字段

| 字段                                                            | 默认                                    | 说明                                                   |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `pets[].display`                                                | —                                       | `web` / `desktop` / `both` / `none`                    |
| `pets[].size`                                                   | 462                                     | 宽度 px（高度 = ×9/16），桌面与浏览器同一尺寸          |
| `pets[].balanceEnabled`                                         | —                                       | 余额动画 + 余额气泡                                    |
| `pets[].whisperEnabled` / `workStatusEnabled` / `peekEnabled`   | true / true / **false**                 | 三项联动开关（碎碎念会调用模型，注意 KV cache）        |
| `whisperPrompt` / `peekPrompt`                                  | 内置人设                                | 碎碎念 / 窥屏人设（**条目级可覆盖**）                  |
| `chatMemoryRounds`                                              | 5                                       | 每次对话带多少轮历史进上下文                           |
| `whisperImageEnabled` / `chatImageEnabled`                      | true                                    | 表情包配图（对话配图每条消息都附整张清单，token 更贵） |
| `notificationsEnabled`                                          | true                                    | 系统通知总开关                                         |
| `confineToScreen`                                               | false                                   | 抛掷锁定在当前屏                                       |
| `hideOnFullscreen`                                              | false                                   | 全屏时隐藏桌宠（Windows）                              |
| `sfxEnabled` / `sfxVolume` / `sfxDecision`                      | true / 0.8 / `need-decision.mp3`        | 决定提醒音                                             |
| `peekScreenEnabled` / `peekPomodoroEnabled`                     | false / true                            | 窥屏允许截图 / 联动番茄钟                              |
| `physics`                                                       | 见上                                    | 拖拽抛掷手感                                           |
| `eventsRefreshSec`                                              | `{balance:1800, whisper:300, peek:600}` | 各事件周期（秒）                                       |
| `animations` / `animationWeights` / `workStatusTexts` / `memes` | —                                       | 动画池 / 权重 / 工作状态文案 / 表情包描述              |

### 恢复默认 / 同步

- 设置页「同步」：把内置默认（含注释的**整份原文**）写进用户层文件 —— 既是恢复默认，也给出一份可直接编辑的完整配置。
  ⚠️ 注意：文件一旦生成即为**显式覆盖层**，插件升级后内置默认的变化不会自动生效（除非再次同步或删掉该文件）；
  点「保存」会按白名单重写它（字段值保留，注释会丢）。
- 想彻底回到"没有任何用户配置"：删掉 `main-config.jsonc`。

---

## 自定义素材

| 素材                       | 放哪（用户目录优先 → 包内兜底）                                             | 说明                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **动画**                   | `~/.dsh/dsh-pet-desktop/main-animation/webm/<动画名>.webm` → `assets/webm/` | 文件名必须与配置里写的动画名一致（不含扩展名，中文/空格都行）；**必须放在 `webm/` 子目录里**                             |
| **音频**（提醒音）         | `~/.dsh/dsh-pet-desktop/main-sound/<文件名>` → `assets/sound/`              | 见上文；用户目录改完不用重装                                                                                             |
| **字体**（气泡/面板/菜单） | 包内 `assets/fonts/上首软糖体.ttf`（随包发布，无需配置）                    | 想换字体：替换这个文件，或改 CSS 里的 `font-family` 回退栈（`src/client/bubble.ts`、`src/shared/productivity-panel.ts`） |
| **表情包**                 | 包内 `assets/memes/<名称>.png` + 配置 `memes` 里的「名称 → 描述」           | 描述会进提示词，让模型配合画面说话                                                                                       |
| **文件宠物**               | `pet/<名>-config.json` + `pet/<名>-animation/webm/`                         | 独立人设/素材/开关；**永不回写**，设置页也不列它                                                                         |

---

## 存储位置与卸载

| 位置                                         | 内容                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.dsh/dsh-pet-desktop/`                    | 用户配置 `main-config.jsonc`、对话记忆 `memory.json`、番茄钟与 Todo `productivity.json`、自定义动画 `main-animation/`、提醒音 `main-sound/`、文件宠物 `pet/` |
| `~/.dsh/electron/`                           | 桌面模式用的 Electron 运行时（体积大；删了下次启用会自动重下）                                                                                               |
| `%APPDATA%/dsh-pet-desktop-electron-helper/` | 桌面窗口的 Chromium profile 与主屏缩放缓存（可删，会自动重建）                                                                                               |

卸载：先退出 DSH（桌宠随之退出），再

```bash
dsh plugin --profile <profile> remove dsh-pet-desktop
```

需要保留配置就先备份 `main-config.jsonc`。

---

## 开发

```bash
npm install
npm test              # 385 项（node:test，走 --experimental-strip-types 直接跑 .ts）
npm run typecheck     # tsc --noEmit + 测试 tsconfig
npm run lint          # eslint
npm run format        # prettier --write

npm run bundle          # tsdown → lib/index.js（宿主半侧）+ lib/client.js（浏览器半侧）
npm run build:desktop-core   # rolldown → runtime/electron-helper/shared-core.js（window.PetShared）
npm run types          # 生成 lib/types/*.d.ts

npm run prepare        # 发布链：types → typecheck → lint → format:check → prepack-check
```

> ⚠️ **改 `src/shared/` 之后一定要跑 `npm run build:desktop-core`**：桌面端渲染层用的是构建产物
> `shared-core.js`，不重建的话新逻辑在桌面窗口里"看不见"（浏览器半侧则要 `npm run bundle`）。
> 这两个产物都在版本库里，改源码必须一起提交。

### 目录结构

```
src/
  shared/   两端共用的纯逻辑与 DOM 组件（拍平配置/选择器/物理/菜单/气泡/面板/SFX 契约…）
  host/     宿主半侧：路由、配置合并与校验、LLM 调用、桌宠窗口进程托管、命令
  client/   浏览器半侧：React overlay（宠物本体、设置页、通知）
runtime/electron-helper/   桌面模式：Electron 主进程 + 渲染端（sprite/events/renderer）
assets/   内置配置、动画、字体、表情包、通知图标、预览 GIF
scripts/  构建与发布链（ensure-electron / prepare / prepack-check / gen-types …）
```

**架构要点**：配置只有一个读取入口（`src/host/config.ts` 的 `readAllConfig`，返回字段填满的成品聚合），
两端消费同一份成品；桌面渲染层是固定构建产物，所以两端行为严格对齐靠"纯逻辑放 `src/shared` + 各自的薄壳"。

### 桌面端调试

- 冒烟自检（截图 + DOM 快照 + 交互/菜单自检）：设 `DSH_PET_DESKTOP_SMOKE=1` 启动 helper，
  产物写 `DSH_PET_DESKTOP_SMOKE_OUT`（默认临时目录 `dsh-pet-desktop-smoke.png`）。
- 常用 env：`DSH_PET_DESKTOP_ELECTRON_PATH`、`DSH_PET_DESKTOP_ELECTRON_MIRROR`、
  `DSH_PET_DESKTOP_FORCE_DSF=0`（关掉多屏 DPI 线性化，排障用）、`DSH_PET_DESKTOP_FORCE=1`（无图形环境强行拉起）。

---

## 平台支持与已知限制

| 能力                                         | Windows                              | macOS / Linux      |
| -------------------------------------------- | ------------------------------------ | ------------------ |
| 浏览器 overlay、碎碎念/对话/余额/番茄钟/Todo | ✅                                   | ✅                 |
| 桌面透明小窗                                 | ✅（有专门的 DWM 黑屏/DPI 规避）     | 理论可用，未做验证 |
| 全屏时自动隐藏                               | ✅（`SHQueryUserNotificationState`） | ❌ 不生效          |
| 窥屏的窗口情报 / 截图                        | ✅（koffi + `desktopCapturer`）      | ❌ 拿不到前台窗口  |
| 决定提醒音                                   | ✅                                   | ✅                 |

其他限制：

- **窥屏仅桌面模式**：浏览器拿不到"别的应用在干嘛"；浏览器端只看 Fullscreen API（F11 那种浏览器级全屏检测不到）。
- **截图需要多模态模型**：纯文本模型（如 `deepseek-flash`）会自动退回"只看窗口标题"模式。
- **每次 AI 互动都是一次真实模型调用**：碎碎念/窥屏按周期调用；本地 LLM 单并发时后台碎碎念会顶掉正在跑的任务的 KV cache，
  不需要就把对应开关关掉。
- **宠物被自动隐藏后右键点不到它**：改回「全屏时隐藏」开关请去 DSH 设置页。
- 桌面模式依赖 `koffi`（FFI，约 1.7MB、按平台预编译）用于全屏检测与窗口情报；缺失时会**静默降级**（对应功能不生效，其余照常）。

---

## English Quick Start

**dsh-pet-desktop** is a desktop-pet plugin for DeepSeek Harness: a Q-style maid that floats on your desktop
(and/or in the DSH web page), walks around, can be dragged and thrown, comments on your work
(whispers, chat with memory, "screen peeking" remarks), follows DSH work state with animations,
ships a Pomodoro timer + Todo list, and plays an alert sound when DSH needs a decision from you.

- **Install**: `dsh plugin add dsh-pet-desktop` (or install it from the DSH plugin marketplace by package name).
  The first desktop-mode start downloads an Electron runtime into `$DSH_HOME/electron`.
- **Right-click the pet** for everything: chat, whisper, peek, balance, Pomodoro/Todo, pet config panel, animation playback.
- **Settings**: DSH → Settings → "Pet Config" (pets, global toggles, physics, peek persona, alert sound, storage paths).
- **Slash commands**: `/balance`, `/pet`, `/chat`.
- **Config**: bundled defaults `assets/config.jsonc`, your overrides in `~/.dsh/dsh-pet-desktop/main-config.jsonc`,
  extra "file pets" in `~/.dsh/dsh-pet-desktop/pet/<name>-config.json`. Animations go to
  `~/.dsh/dsh-pet-desktop/main-animation/webm/`, the alert sound to `.../main-sound/`.
- **Windows-only extras**: hide-on-fullscreen detection and foreground-window intel (peek). Screenshot peeking
  additionally requires a multimodal model.

Full details are in the Chinese sections above.

---

## License

[MIT](LICENSE) © 2026 PC2005-cloud
