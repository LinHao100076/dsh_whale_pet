import { type ProductivityAction, type ProductivitySnapshot } from '../shared/productivity';
export type { ProductivitySnapshot } from '../shared/productivity';
export declare const PRODUCTIVITY_FILE = "productivity.json";
export declare function defaultProductivitySnapshot(): ProductivitySnapshot;
export declare function validateProductivitySnapshot(value: unknown): ProductivitySnapshot;
export declare function readProductivitySnapshot(root: string): Promise<ProductivitySnapshot>;
export declare function writeProductivitySnapshot(root: string, snapshot: ProductivitySnapshot): Promise<void>;
export declare function reconcileProductivitySnapshot(root: string, now?: number): Promise<ProductivitySnapshot>;
export declare function mutateProductivitySnapshot(root: string, action: ProductivityAction, now?: number): Promise<ProductivitySnapshot>;
