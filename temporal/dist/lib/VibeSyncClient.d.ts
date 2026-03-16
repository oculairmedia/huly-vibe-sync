export interface VibeSyncClientOptions {
    timeout?: number;
}
export declare class VibeSyncClient {
    private baseUrl;
    private timeout;
    constructor(baseUrl: string, options?: VibeSyncClientOptions);
    private request;
    syncBeads(payload: {
        projectId: string;
    }): Promise<{
        message?: string;
        results?: Array<{
            project: string;
            workflowId?: string;
            error?: string;
        }>;
    }>;
    deleteBeads(payload: {
        beadsId: string;
    }): Promise<{
        success?: boolean;
    }>;
}
export declare function clearVibeSyncClientCache(): void;
export declare function createVibeSyncClient(url?: string, options?: VibeSyncClientOptions): VibeSyncClient;
//# sourceMappingURL=VibeSyncClient.d.ts.map