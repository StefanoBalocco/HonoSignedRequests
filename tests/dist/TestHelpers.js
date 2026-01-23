import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { hmacSha256 } from '../../dist/Common.js';
export const DEFAULT_VALIDITY_TOKEN = 3600000;
export const DEFAULT_TOKEN_LENGTH = 32;
export class LocalStorageMock {
    store = new Map();
    getItem(key) {
        return this.store.get(key) || null;
    }
    setItem(key, value) {
        this.store.set(key, value);
    }
    removeItem(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
export function base64urlEncode(value) {
    const base64String = Array.from(value, (byte) => String.fromCharCode(byte)).join('');
    return btoa(base64String)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
export async function createSignature(session, timestamp, parameters = []) {
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', timestamp],
        ...parameters.sort((a, b) => a[0].localeCompare(b[0]))
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signature = await hmacSha256(session.token, dataToSign);
    return {
        signature,
        signatureBase64: base64urlEncode(signature)
    };
}
export function createHonoApp() {
    return new Hono();
}
export function createStorageAndManager(config) {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage, config);
    return { storage, manager };
}
export function createMiddlewareApp(manager, path = '/api/*') {
    const app = createHonoApp();
    app.use(path, manager.middleware);
    return app;
}
export function createAuthenticatedApp(manager, options = {}) {
    const app = createHonoApp();
    const { loginEndpoint = '/auth/login', protectedPaths = '/api/*' } = options;
    app.post(loginEndpoint, async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const { username, password } = body;
        if (username === 'test' && password === 'password') {
            const session = await manager.createSession(1);
            const tokenBase64 = base64urlEncode(session.token);
            return c.json({
                sessionId: session.id,
                token: tokenBase64,
                sequenceNumber: session.sequenceNumber
            });
        }
        return c.json({ error: 'Invalid credentials' }, 401);
    });
    app.use(protectedPaths, manager.middleware);
    return app;
}
export function getAvailablePort() {
    return 3000 + Math.floor(Math.random() * 1000);
}
