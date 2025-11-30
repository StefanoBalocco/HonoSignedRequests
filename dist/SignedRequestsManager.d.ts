import { MiddlewareHandler } from 'hono';
import { SessionsStorage } from './SessionsStorage';
export declare class SignedRequestsManager {
    private readonly _storage;
    constructor(storage?: SessionsStorage);
    middleware: MiddlewareHandler;
}
