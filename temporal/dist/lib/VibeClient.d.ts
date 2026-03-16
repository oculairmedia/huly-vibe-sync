export interface VibeTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    project_id?: string;
    hulyRef?: string;
}
export interface CreateVibeTaskInput {
    title: string;
    description?: string;
    status: string;
    hulyRef?: string;
}
export interface VibeClientOptions {
    timeout?: number;
    name?: string;
}
export declare class VibeClient {
    private baseUrl;
    private timeout;
    constructor(baseUrl: string, options?: VibeClientOptions);
    private request;
    createTask(projectId: string, data: CreateVibeTaskInput): Promise<VibeTask>;
    updateTask(taskId: string, updates: Partial<VibeTask>): Promise<VibeTask>;
    deleteTask(taskId: string): Promise<boolean>;
}
export declare function clearVibeClientCache(): void;
export declare function createVibeClient(url?: string, options?: VibeClientOptions): VibeClient;
//# sourceMappingURL=VibeClient.d.ts.map