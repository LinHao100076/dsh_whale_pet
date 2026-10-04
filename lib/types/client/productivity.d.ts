import type { ProductivitySnapshot } from '../host/productivity-store';
export declare const productivityBridge: {
    current: ProductivitySnapshot | null;
    load(): Promise<ProductivitySnapshot>;
    save(snapshot: ProductivitySnapshot): Promise<ProductivitySnapshot>;
    action(action: "start" | "pause" | "resume" | "skip" | "reset", todoId?: string | null): Promise<ProductivitySnapshot>;
    reconcile(now?: number): ProductivitySnapshot | null;
};
