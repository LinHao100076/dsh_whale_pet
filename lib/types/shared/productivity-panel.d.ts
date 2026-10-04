export interface ProductivityPanelOptions {
    onOpenChange?: (open: boolean) => void;
}
export declare function formatPomodoroTime(seconds: number): string;
export declare function productivityActionUrl(baseUrl: string): string;
export declare function mountProductivityPanel(baseUrl: string, mode?: 'config' | 'productivity', options?: ProductivityPanelOptions): {
    close: () => void;
};
