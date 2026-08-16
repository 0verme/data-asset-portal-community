interface AssetFetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
interface WorkerEnv {
    ASSETS: AssetFetcher;
}
declare const _default: {
    fetch(request: Request, env: WorkerEnv): Promise<Response>;
};
export default _default;
//# sourceMappingURL=worker.d.ts.map