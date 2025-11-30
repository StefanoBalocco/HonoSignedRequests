type SessionConfig = {
    sessionId: number;
    token: string;
    sequenceNumber: number;
};
type SignedRequest<T = Record<string, any>> = T & {
    sessionId: number;
    timestamp: number;
    signature: string;
};
type SignedRequestOptions = {
    baseUrl?: string;
    headers?: Record<string, string>;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
};
declare class SignedRequester {
    private static readonly _primitives;
    private _sessionId;
    private _token;
    private _sequenceNumber;
    private _baseUrl;
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
export declare const sessionManager: SignedRequester;
export type { SessionConfig, SignedRequest, SignedRequestOptions };
export { SignedRequester };
