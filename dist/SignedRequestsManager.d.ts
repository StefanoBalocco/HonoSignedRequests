import { MiddlewareHandler } from 'hono';
import { Undefinedable } from './Common';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';
type SignedRequestsManagerConfig = {
    validitySignature: number;
    validityToken: number;
    tokenLength: number;
};
export declare class SignedRequestsManager {
    private static readonly _primitives;
    private readonly _storage;
    private readonly _validitySignature;
    private readonly _validityToken;
    private readonly _tokenLength;
    constructor(storage?: SessionsStorage, options?: Partial<SignedRequestsManagerConfig>);
    createSession(userId: number): Promise<Session>;
    validate(sessionId: number, timestamp: number, parameters: [string, any][], signature: Uint8Array<ArrayBuffer>): Promise<Undefinedable<Session>>;
    middleware: MiddlewareHandler;
}
export {};
