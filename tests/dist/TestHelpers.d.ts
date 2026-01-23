import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { Session } from '../../dist/Session.js';
export declare const DEFAULT_VALIDITY_TOKEN = 3600000;
export declare const DEFAULT_TOKEN_LENGTH = 32;
export type Env = {
    Variables: {
        session?: Session;
    };
};
export declare class LocalStorageMock {
    private store;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
}
export declare function base64urlEncode(value: Uint8Array): string;
export declare function createSignature(session: Session, timestamp: number, parameters?: [string, any][]): Promise<{
    signature: Uint8Array<ArrayBuffer>;
    signatureBase64: string;
}>;
export declare function createHonoApp(): Hono<Env>;
export declare function createStorageAndManager(config?: Partial<{
    validitySignature: number;
    validityToken: number;
    tokenLength: number;
    onError: (error: unknown) => void;
}>): {
    storage: SessionsStorageLocal;
    manager: SignedRequestsManager;
};
export declare function createMiddlewareApp(manager: SignedRequestsManager, path?: string): Hono<Env>;
export declare function createAuthenticatedApp(manager: SignedRequestsManager, options?: {
    loginEndpoint?: string;
    protectedPaths?: string;
}): Hono<Env, import("hono/types").BlankSchema, "/">;
export declare function getAvailablePort(): number;
