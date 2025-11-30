import { MiddlewareHandler } from 'hono';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';
type SignedRequestsManagerConfig = {
    validitySignature: number;
    validityToken: number;
    tokenLength: number;
};
export declare class SignedRequestsManager {
    private readonly _storage;
    private readonly _validitySignature;
    private readonly _validityToken;
    private readonly _tokenLength;
    constructor(storage?: SessionsStorage, options?: Partial<SignedRequestsManagerConfig>);
    createSession(userId: number): Promise<Session>;
    middleware: MiddlewareHandler;
}
export {};
