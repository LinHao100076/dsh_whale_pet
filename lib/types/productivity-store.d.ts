import { type ProductivityAction, type ProductivitySnapshot } from '../shared/productivity';
export type { ProductivitySnapshot } from '../shared/productivity';
export declare const PRODUCTIVITY_FILE = "productivity.json";
export declare function defaultProductivitySnapshot(): ProductivitySnapshot;
export declare function validateProductivitySnapshot(value: unknown): ProductivitySnapshot;
/** 每个专注周期完成后，把「该记给哪条待办」告诉调用方（纯函数，不碰存储） */
export interface FocusCompletion {
    /** 关联任务的 id（当时没关联就是 null） */
    todoId: string | null;
    /** 这一次调用跨过了几个专注周期（长时间挂起后 reconcile 可能一次跨过多个） */
    count: number;
}
/**
 * 比较前后两份快照，得出"这次跨过了几个专注周期、记给谁"。
 *
 * 为什么要从**前**一份快照取 todoId：`pomodoro` 在切换到休息阶段时会把 state.todoId 置空
 * （见 shared/pomodoro.ts 的 advanceTimer），所以完成之后已经读不到关联任务了——那时它已经被清掉。
 */
export declare function focusCompletions(before: ProductivitySnapshot, after: ProductivitySnapshot): FocusCompletion;
export declare function readProductivitySnapshot(root: string): Promise<ProductivitySnapshot>;
export declare function writeProductivitySnapshot(root: string, snapshot: ProductivitySnapshot): Promise<void>;
export declare function reconcileProductivitySnapshot(root: string, now?: number): Promise<ProductivitySnapshot>;
export interface ProductivityMutation {
    before: ProductivitySnapshot;
    after: ProductivitySnapshot;
}
/**
 * 与 `mutateProductivitySnapshot` 同一件事，但把**改之前**的快照也返回。
 * 用途：番茄钟与待办解耦之后，"这个专注周期该记给哪条待办"只能靠前后对比得出
 * （见 focusCompletions 的说明：完成后 state.todoId 已被清空）。
 * 读取放在同一个串行区间里，避免"先在队列外读一次"带来的竞态。
 */
export declare function mutateProductivitySnapshotWithBefore(root: string, action: ProductivityAction, now?: number): Promise<ProductivityMutation>;
/** 对账版（窥屏读情报时用）：同样返回前后，好把期间跨过的周期记给待办 */
export declare function reconcileProductivitySnapshotWithBefore(root: string, now?: number): Promise<ProductivityMutation>;
export declare function mutateProductivitySnapshot(root: string, action: ProductivityAction, now?: number): Promise<ProductivitySnapshot>;
