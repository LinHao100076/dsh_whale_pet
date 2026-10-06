/**
 * 「待办日历」面板（src/shared，浏览器与桌面宠物窗口共用一份 DOM）。
 *
 * 参考 Obsidian 的 Note Calendar：左侧月历（含周数列）+ 单元格圆点 + 选中日期看当天条目。
 * 在此之上补了待办特有的三块：**未排期收集箱**、**逾期分组**、**拖拽改期**。
 *
 * 与 productivity-panel 的取舍差异：
 *   - 数据源是独立存储 `todos.json`（走 /todo 与 /todo/action），**不再读写 productivity.json**；
 *   - 所有改动都是"提交一个动作 → 用返回的整份清单重渲染"，不做本地乐观更新后对账
 *     （待办是低频操作，简单可靠优先；重渲染只重建右侧列表与格子圆点，成本极低）；
 *   - 日期全部用**本地日期键**（见 shared/calendar.ts 的说明），绝不用 toISOString。
 *
 * 农历/节气/调休的标注（Stage 3）会从 /todo/calendar 接口拿到"某天的附加文字"，
 * 本文件只负责渲染——不引入农历库，保证两端 bundle 都不背这个包袱。
 */
import { type TodoDateField } from './calendar';
export interface TodoPanelOptions {
    onOpenChange?: (open: boolean) => void;
    /** 打开时的初始视图（截止/计划），默认按截止 */
    initialField?: TodoDateField;
}
/** 「待办日历」里某天的附加标注（Stage 3 的农历/节气/调休由 host 提供；现在允许为空） */
export interface TodoDayAnnotation {
    /** 农历日期文案（如「初二」/「腊月」） */
    lunar?: string;
    /** 节日/节气文案（如「中秋」「立秋」） */
    term?: string;
    /** 调休：'off' = 休（放假）/'work' = 班（调休上班）；缺省 = 普通日 */
    dayType?: 'off' | 'work' | null;
}
/**
 * 挂载待办日历面板。返回 { close }（与 productivity-panel 同契约）。
 * @param baseUrl 待办端点基址（如 '/dsh-pet-desktop-7340/todo' 或桌面端的 BASE + '/todo'）
 */
export declare function mountTodoPanel(baseUrl: string, options?: TodoPanelOptions): {
    close: () => void;
};
