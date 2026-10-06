/**
 * 「待办日历」的接线守卫（宿主路由 / 面板 / 菜单 / 两端入口）。
 *
 * 这一层是纯源码断言：Electron 与浏览器环境在单测里起不来，但"有没有接上"必须能验证。
 * 重点钉住三件容易回归的事：
 *   ① 路由语义（GET /todo 只读、POST /todo/action 才写；校验失败回 400 而不是静默 200）；
 *   ② 迁移接线（宿主必须注入 legacy 读取器，并在启动时先跑一次迁移）；
 *   ③ 编辑保存**必须发两个动作**（update 改文本 + reschedule 改日期）——
 *      只发 update 会"标题存上了、日期没生效"，这种静默半成功是最难发现的 bug。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * 剥掉注释再断言。
 * 必须这么做：`calendar.ts` 的注释里正写着"绝不用 toISOString()"——不剥注释的话，
 * 守卫会被自己的说明文字绊倒（第一次跑就是这么失败的）。
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('源码守卫 —— 宿主路由与迁移接线', () => {
  const host = readSource('../host/index.ts');

  test('GET /todo 只读，POST /todo/action 才写', () => {
    assert.ok(/if \(rest === 'todo'\) \{/.test(host), '必须有 /todo 路由');
    assert.ok(
      /if \(rest === 'todo'\) \{\s*if \(method !== 'GET'\) return \{ kind: 'json', status: 405/.test(host),
      '/todo 只接受 GET',
    );
    assert.ok(/if \(rest === 'todo\/action'\) \{/.test(host), '必须有 /todo/action');
    assert.ok(
      /if \(rest === 'todo\/action'\) \{\s*if \(method !== 'POST'\) return \{ kind: 'json', status: 405/.test(host),
      '/todo/action 只接受 POST',
    );
    assert.ok(/status: 400, obj: \{ ok: false, error: 'missing action type' \}/.test(host), '缺 action 类型回 400');
    assert.ok(/await mutateTodos\(userRoot, action\)/.test(host), '写入必须走 mutateTodos（原子写 + 串行）');
    assert.ok(/await loadTodos\(userRoot\)/.test(host), '读取必须走 loadTodos（含一次性迁移）');
  });

  test('迁移接线：注入 legacy 读取器（读 productivity.json）+ 启动先跑一次', () => {
    assert.ok(/configureTodoStore\(\{/.test(host), '必须配置存储');
    assert.ok(/readLegacy: \(\) => readProductivitySnapshot\(userRoot\)/.test(host), 'legacy 来源必须是番茄钟那份快照');
    assert.ok(
      /void ensureTodoStore\(userRoot\)\.catch\(/.test(host),
      '启动时先跑一次迁移（日志可见、不等用户点开面板）',
    );
  });

  test('标注路由：/todo/calendar 只读、/todo/calendar/refresh 只 POST，month 要校验', () => {
    assert.ok(/if \(rest === 'todo\/calendar' \|\| rest === 'todo\/calendar\/refresh'\)/.test(host));
    assert.ok(/if \(method !== \(refresh \? 'POST' : 'GET'\)\)/.test(host), '读用 GET、刷新用 POST');
    assert.ok(/month 必须是 YYYY-MM/.test(host), '非法 month 要回 400 而不是静默取当月');
    assert.ok(/await buildMonthDays\(\{/.test(host), '标注必须走 buildMonthDays（农历 + 调休 + 降级都在那里）');
    assert.ok(/force: refresh/.test(host), '手动刷新必须 force（绕过缓存 TTL）');
    assert.ok(/warn: \(message\) => ctx\.logger/.test(host), '降级告警要进日志');
  });
});

describe('源码守卫 —— 标注层（农历/调休）', () => {
  const calendar = readSource('../host/todo-calendar.ts');

  test('上游格式与缓存格式**分开解析**（混用会让 TTL 与降级静默失效）', () => {
    assert.ok(/export function parseHolidayDocument\(/.test(calendar), '上游解析器必须在');
    assert.ok(/export function parseHolidayCache\(/.test(calendar), '缓存解析器必须在');
    assert.ok(/return parseHolidayCache\(JSON\.parse\(raw\)\)/.test(calendar), '读缓存只能走缓存解析器');
    assert.ok(!/parseHolidayDocument\(JSON\.parse\(raw\)\)/.test(calendar), '读缓存不得走上游解析器');
  });

  test('农历库是可选增强：动态 import + 兼容 CJS 互操作 + 失败只告警', () => {
    assert.ok(/import\('lunar-javascript'\)/.test(calendar), '必须动态 import（装不上也不能让插件起不来）');
    assert.ok(/export function resolveLunarModule\(/.test(calendar), '必须有模块形状解析（Solar 可能挂在 default 上）');
    assert.ok(/农历库不可用/.test(calendar), '加载失败要告警一次');
  });

  test('调休数据：缓存优先 + 过去年份永久有效 + 失败回退旧缓存', () => {
    assert.ok(/holidayCdnUrl\(year\)/.test(calendar), '必须有明确的 CDN 地址来源');
    assert.ok(/const finalYear = year < new Date\(now\)\.getFullYear\(\)/.test(calendar), '过去的年份不该再联网');
    assert.ok(
      /继续用本地缓存/.test(calendar) && /不会显示「休\/班」角标/.test(calendar),
      '失败提示要区分"有缓存/没缓存"',
    );
  });

  test('网格跨年时两年调休数据都要取', () => {
    assert.ok(/const years = \[\.\.\.new Set\(keys\.map/.test(calendar), '必须按网格里出现的年份去重取数');
  });
});

describe('源码守卫 —— 面板本身', () => {
  const panel = readSource('../shared/todo-panel.ts');

  test('月历 / 周数列 / 圆点 / 双日期切换 / 收集箱 / 逾期 都在', () => {
    assert.ok(/export function mountTodoPanel\(/.test(panel), '必须导出面板');
    assert.ok(/monthGrid\(month, 1\)/.test(panel), '必须用 monthGrid（周一起始 + 周数列）');
    assert.ok(/node\('span', 'dshtd-weekno'/.test(panel), '周数列必须在');
    assert.ok(/todoCountsByDate\(todos, field\)/.test(panel), '格子圆点必须走计数函数');
    assert.ok(/field === 'due' \? 'scheduled' : 'due'/.test(panel), '截止/计划双日期必须可切换');
    assert.ok(/unscheduledTodos\(todos\)/.test(panel), '收集箱必须在');
    assert.ok(/overdueTodos\(todos, today\)/.test(panel), '逾期分组必须在');
  });

  test('拖拽改期：drop 到格子上发 reschedule（按当前视图字段）', () => {
    assert.ok(/cell\.addEventListener\('drop'/.test(panel), '格子必须能接收拖拽');
    assert.ok(
      /const patch = field === 'due' \? \{ dueDate: day\.key \} : \{ scheduledDate: day\.key \}/.test(panel),
      '改期必须按当前视图改对应字段',
    );
    assert.ok(/void act\(\{ type: 'reschedule', id, patch \}/.test(panel), '改期必须走 reschedule 动作');
  });

  test('编辑保存 = update + reschedule 两个动作（防"标题存了日期没存"的静默半成功）', () => {
    assert.ok(/await act\(\{ type: 'update', id: todo\.id, patch: \{ title: titleInput\.value/.test(panel));
    assert.ok(/await act\(\s*\{\s*type: 'reschedule',[\s\S]{0,200}?dueDate: dueInput\.value \|\| null/.test(panel));
  });

  test('DOM 文本里不得混进 markdown 语法（星号会原样显示给用户）', () => {
    // 真实踩过：提示语写成 '把待办**拖到格子上**' → 界面上真的显示了两个星号
    assert.ok(!/\*\*/.test(stripComments(panel)), '面板文本里不得出现 markdown 强调语法');
  });

  test('日期一律本地日期键（绝不用 toISOString：东八区会串天）', () => {
    assert.ok(!/toISOString\(\)/.test(stripComments(panel)), '面板不得用 toISOString 生成日期');
    assert.ok(
      !/\.toISOString\(/.test(stripComments(readSource('../shared/calendar.ts'))),
      '日历纯逻辑不得用 toISOString',
    );
  });

  test('农历/调休标注是"可选增强"：接口不在也必须照常工作', () => {
    assert.ok(/\/calendar\?month=/.test(panel), '必须尝试拉取标注');
    assert.ok(/catch \{\s*annotations = \{\};/.test(panel), '拉取失败要降级成"没有标注"，不能影响日历本体');
    assert.ok(/\/calendar\/refresh\?month=/.test(panel), '必须有手动刷新入口（绕过缓存 TTL）');
    assert.ok(/method: 'POST'/.test(panel), '刷新必须用 POST');
    assert.ok(!/lunar-javascript/.test(panel), '面板不得引入农历库（那在宿主侧算，两端 bundle 不背这个包袱）');
  });
});

describe('源码守卫 —— 菜单与两端入口', () => {
  test('菜单项「待办日历」在共享菜单树里（两端都吃得到）', () => {
    const menu = readSource('../shared/menu.ts');
    assert.ok(/\{ label: '待办日历', action: 'open-todo' \}/.test(menu));
    assert.ok(/\| 'open-todo'/.test(menu), 'action 类型必须包含 open-todo');
  });

  test('桌面端：open-todo 挂面板，并与其它面板共用同一个槽位（先关旧的）', () => {
    const sprite = readSource('../../runtime/electron-helper/sprite.js');
    assert.ok(/this\.todoPanelClose = null;/.test(sprite), '必须有面板句柄字段');
    assert.ok(/leaf\.action === 'open-todo'/.test(sprite), '必须分发 open-todo');
    assert.ok(/S\.mountTodoPanel\(BASE \+ '\/todo'/.test(sprite), '必须挂到 /todo 端点');
    assert.ok(/if \(this\.todoPanelClose\) this\.todoPanelClose\(\);/.test(sprite), '开新面板前先关旧的');
    assert.ok(
      /if \(!open\) \{\s*this\.productivityPanelClose = null;\s*this\.todoPanelClose = null;/.test(sprite),
      '关闭时两个句柄都要清',
    );
    assert.ok(
      /if \(this\.todoPanelClose\) \{\s*this\.todoPanelClose\(\);\s*this\.todoPanelClose = null;/.test(sprite),
      'dispose 必须关掉面板',
    );
  });

  test('浏览器端：open-todo 也挂同一份面板', () => {
    const pet = readSource('../client/pet.ts');
    assert.ok(/import \{ mountTodoPanel \} from '..\/shared\/todo-panel'/.test(pet));
    assert.ok(/mountTodoPanel\('\/dsh-pet-desktop-7340\/todo'\)/.test(pet));
  });
});

describe('源码守卫 —— 番茄钟与待办已解耦', () => {
  const productivity = readSource('../shared/productivity.ts');
  const store = readSource('../host/productivity-store.ts');
  const host = readSource('../host/index.ts');
  const panel = readSource('../shared/productivity-panel.ts');

  test('番茄钟不再自己给待办记番茄数（否则两处计数、真相分裂）', () => {
    assert.ok(!/recordCompletedFocus/.test(productivity), 'productivity 不该再调用 recordCompletedFocus');
    assert.ok(
      /番茄钟这边只保留 state\.todoId 这个\*\*引用\*\*/.test(productivity),
      '必须写明为什么不再累加（给未来的自己留话）',
    );
  });

  test('宿主是唯一的连接点：对比前后快照 → 记给待办存储', () => {
    assert.ok(/const syncPomodoroFocus = async \(mutation: ProductivityMutation\)/.test(host), '必须有连接点');
    assert.ok(/const \{ todoId, count \} = focusCompletions\(mutation\.before, mutation\.after\)/.test(host));
    assert.ok(/await recordTodoFocus\(userRoot, todoId\)/.test(host), '必须写进待办存储');
    assert.ok(/await syncPomodoroFocus\(mutation\)/.test(host), '动作路径要调用');
    assert.ok(/await syncPomodoroFocus\(\{ before, after \}\)/.test(host), '读情报的路径也要调用（对账也可能跨周期）');
    assert.ok(
      /export function focusCompletions\(/.test(store) && /before\.pomodoro\.state\.todoId/.test(store),
      '必须从**动作前**的快照取关联任务 id（完成后已被清空）',
    );
  });

  test('todoId 只是引用：存储层不再交叉校验它是否在快照的 todos 里', () => {
    assert.ok(!/Invalid selected Todo/.test(store), '交叉校验必须移除');
    assert.ok(/if \(v\.todos\.length > 0\)/.test(store), '遗留 todos 仍要校验形状（迁移要用）');
  });

  test('响应带 linkedTodo：气泡标题来自待办存储，客户端零额外请求', () => {
    assert.ok(/const withLinkedTodo = async \(snap: ProductivitySnapshot\)/.test(host));
    assert.ok(/obj: await withLinkedTodo\(after\)/.test(host), 'GET /productivity 要带上');
    assert.ok(/obj: await withLinkedTodo\(mutation\.after\)/.test(host), '动作响应也要带上');
    assert.ok(/view\.linkedTodo \?\?/.test(productivity), '气泡优先用 linkedTodo');
  });

  test('番茄钟面板只剩「关联任务」：候选来自 /todo，不再能增删改待办', () => {
    assert.ok(/const todoEndpoint = `\$\{baseUrl\.replace\(\/\\\/productivity\\\/\?\$\/, ''\)\}\/todo`/.test(panel));
    assert.ok(/requestJson<\{ todos\?: TodoItem\[\] \}>\(todoEndpoint\)/.test(panel), '候选必须来自待办存储');
    assert.ok(/dshpd-section-title', '关联任务'\)/.test(panel), '区块标题应改成「关联任务」');
    assert.ok(/待办清单已独立为「待办日历」/.test(panel), '要告诉用户去哪儿管理待办');
    // 被删掉的旧 UI 不能再冒出来
    for (const gone of ['renderTodo', 'moveTodo', 'todoForm', 'newEstimate', 'todoList', 'draggedTodoId']) {
      assert.ok(!new RegExp(`\\b${gone}\\b`).test(stripComments(panel)), `旧待办 UI 残留：${gone}`);
    }
    assert.ok(!/type: 'todo\.(create|update|delete|complete|reorder)'/.test(panel), '面板不该再提交待办动作');
  });
});
