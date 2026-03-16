type NativeDispatcher = RequestInit extends {
    dispatcher?: infer T;
} ? T : unknown;
type FetchWithDispatcherOptions = RequestInit & {
    dispatcher?: NativeDispatcher;
};
export declare function getPooledDispatcher(url: string): NativeDispatcher;
export declare function pooledFetch(url: string, options?: FetchWithDispatcherOptions): Promise<Response>;
export declare function clearPooledDispatchers(): void;
export {};
//# sourceMappingURL=httpPool.d.ts.map