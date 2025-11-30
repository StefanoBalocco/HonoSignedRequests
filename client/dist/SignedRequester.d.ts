type Methods = 'GET' | 'POST' | 'PUT' | 'DELETE';
type SessionConfig = {
    sessionId: number;
    token: string;
    sequenceNumber: number;
};
type SignedRequest<T = Record<string, any>> = {
    sessionId: number;
    timestamp: number;
    signature: string;
} & T;
type SignedRequestOptions = {
    baseUrl?: string;
    headers?: Record<string, string>;
    method?: Methods;
};
declare class SignedRequester {
    private static readonly _primitives;
    private readonly _baseUrl;
    private _sessionId;
    private _token;
    private _sequenceNumber;
    private _semaphore;
    private _semaphoreQueue;
    private _semaphoreAcquire;
    private _semaphoreRelease;
    private _incrementSequenceNumber;
    private _loadFromStorage;
    constructor(baseUrl?: string);
    setSession(config: SessionConfig): void;
    getSession(): boolean;
    clearSession(): void;
    signedRequest(path: string, parameters: Record<string, any>, options?: SignedRequestOptions): Promise<Response>;
    signedRequestJson<T = any>(path: string, parameters: Record<string, any>, options?: SignedRequestOptions): Promise<T>;
}
export type { SessionConfig, SignedRequest, SignedRequestOptions };
export { SignedRequester };
