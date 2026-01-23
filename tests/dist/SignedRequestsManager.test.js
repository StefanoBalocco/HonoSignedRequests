import test from 'ava';
import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { hmacSha256 } from '../../dist/Common.js';
function createHonoApp() {
    return new Hono();
}
function base64urlEncode(value) {
    const base64String = Array.from(value, (byte) => String.fromCharCode(byte)).join('');
    return btoa(base64String)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
function createStorageAndManager(config) {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage, config);
    return { storage, manager };
}
function createAuthenticatedApp(manager, options = {}) {
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
test('SignedRequestsManager creates session', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage, {
        validitySignature: 5000,
        validityToken: 3600000,
        tokenLength: 32
    });
    const session = await manager.createSession(1);
    t.is(session.userId, 1);
    t.is(session.sequenceNumber, 1);
    t.is(session.token.length, 32);
});
test('SignedRequestsManager validates correct signature', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage);
    const session = await manager.createSession(1);
    const timestamp = Date.now();
    const parameters = [['action', 'test']];
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', timestamp],
        ...parameters
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signature = await hmacSha256(session.token, dataToSign);
    const validatedSession = await manager.validate(session.id, timestamp, parameters, signature);
    t.truthy(validatedSession);
    t.is(validatedSession.id, session.id);
    t.is(validatedSession.sequenceNumber, 2);
});
test('SignedRequestsManager rejects invalid signature', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage);
    const session = await manager.createSession(1);
    const timestamp = Date.now();
    const parameters = [['action', 'test']];
    const wrongSignature = new Uint8Array(32);
    const validatedSession = await manager.validate(session.id, timestamp, parameters, wrongSignature);
    t.is(validatedSession, undefined);
});
test('SignedRequestsManager rejects expired timestamp', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage, {
        validitySignature: 1000
    });
    const session = await manager.createSession(1);
    const oldTimestamp = Date.now() - 2000;
    const parameters = [];
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', oldTimestamp],
        ...parameters
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signature = await hmacSha256(session.token, dataToSign);
    const validatedSession = await manager.validate(session.id, oldTimestamp, parameters, signature);
    t.is(validatedSession, undefined);
});
test('SignedRequestsManager rejects future timestamp', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage);
    const session = await manager.createSession(1);
    const futureTimestamp = Date.now() + 10000;
    const parameters = [];
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', futureTimestamp],
        ...parameters
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signature = await hmacSha256(session.token, dataToSign);
    const validatedSession = await manager.validate(session.id, futureTimestamp, parameters, signature);
    t.is(validatedSession, undefined);
});
test('SignedRequestsManager deletes expired session during validation', async (t) => {
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage, {
        validityToken: 100
    });
    const session = await manager.createSession(1);
    await new Promise(resolve => setTimeout(resolve, 150));
    const timestamp = Date.now();
    const parameters = [];
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', timestamp],
        ...parameters
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signature = await hmacSha256(session.token, dataToSign);
    const validatedSession = await manager.validate(session.id, timestamp, parameters, signature);
    t.is(validatedSession, undefined);
    const retrieved = await storage.getBySessionId(session.id);
    t.is(retrieved, undefined);
});
test('SignedRequestsManager middleware validates POST request', async (t) => {
    const app = createHonoApp();
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage);
    app.use('/api/*', manager.middleware);
    app.post('/api/test', (c) => {
        const session = c.get('session');
        return c.json({ authenticated: !!session, userId: session?.userId });
    });
    const session = await manager.createSession(1);
    const timestamp = Date.now();
    const parameters = { action: 'test' };
    const parametersOrdered = [
        ['sessionId', session.id],
        ['sequenceNumber', session.sequenceNumber],
        ['timestamp', timestamp],
        ['action', 'test']
    ];
    const dataToSign = parametersOrdered
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(';');
    const signatureBytes = await hmacSha256(session.token, dataToSign);
    const signature = base64urlEncode(signatureBytes);
    const res = await app.request('/api/test', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sessionId: session.id,
            timestamp,
            signature,
            ...parameters
        })
    });
    const json = await res.json();
    t.is(res.status, 200);
    t.true(json.authenticated);
    t.is(json.userId, 1);
});
test('SignedRequestsManager middleware rejects invalid signature', async (t) => {
    const app = createHonoApp();
    const storage = new SessionsStorageLocal();
    const manager = new SignedRequestsManager(storage);
    app.use('/api/*', manager.middleware);
    app.post('/api/test', (c) => {
        const session = c.get('session');
        return c.json({ authenticated: !!session });
    });
    const session = await manager.createSession(1);
    const timestamp = Date.now();
    const wrongSignature = base64urlEncode(new Uint8Array(32));
    const res = await app.request('/api/test', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sessionId: session.id,
            timestamp,
            signature: wrongSignature
        })
    });
    const json = await res.json();
    t.is(res.status, 200);
    t.false(json.authenticated);
});
test('SignedRequestsManager uses default storage if none provided', async (t) => {
    const manager = new SignedRequestsManager();
    const session = await manager.createSession(1);
    t.truthy(session);
    t.is(session.userId, 1);
});
import { serve } from '@hono/node-server';
import { SignedRequester } from '../../client/dist/SignedRequester.js';
class LocalStorageMock {
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
const localStorageMock = new LocalStorageMock();
global.localStorage = localStorageMock;
function getAvailablePort() {
    return 3000 + Math.floor(Math.random() * 1000);
}
test.serial('Integration: Client can authenticate and make signed requests', async (t) => {
    localStorageMock.clear();
    const { manager } = createStorageAndManager();
    const app = createAuthenticatedApp(manager);
    app.post('/api/ping', (c) => {
        const session = c.get('session');
        return c.json({ pong: !!session });
    });
    app.post('/api/protected', (c) => {
        const session = c.get('session');
        if (!session) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
        return c.json({ message: 'Success', userId: session.userId });
    });
    const port = getAvailablePort();
    const server = serve({ fetch: app.fetch, port });
    const actualPort = server.address().port;
    const baseUrl = `http://localhost:${actualPort}`;
    try {
        const client = new SignedRequester(baseUrl);
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'test', password: 'password' })
        });
        t.is(loginResponse.status, 200);
        const loginData = await loginResponse.json();
        t.truthy(loginData.sessionId);
        t.truthy(loginData.token);
        t.is(loginData.sequenceNumber, 1);
        client.setSession({
            sessionId: loginData.sessionId,
            token: loginData.token,
            sequenceNumber: loginData.sequenceNumber
        });
        const pingResponse = await client.signedRequestJson('/api/ping', {});
        t.true(pingResponse.pong);
        const protectedResponse = await client.signedRequestJson('/api/protected', {});
        t.is(protectedResponse.message, 'Success');
        t.is(protectedResponse.userId, 1);
        t.is(localStorageMock.getItem('sequenceNumber'), '3');
    }
    finally {
        server.close();
    }
});
test.serial('Integration: Client handles multiple sequential requests correctly', async (t) => {
    localStorageMock.clear();
    const { manager } = createStorageAndManager();
    const app = createAuthenticatedApp(manager);
    app.post('/api/counter', (c) => {
        const session = c.get('session');
        return c.json({ count: session?.sequenceNumber || 0 });
    });
    const port = getAvailablePort();
    const server = serve({ fetch: app.fetch, port });
    const actualPort = server.address().port;
    const baseUrl = `http://localhost:${actualPort}`;
    try {
        const client = new SignedRequester(baseUrl);
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'test', password: 'password' })
        });
        const loginData = await loginResponse.json();
        client.setSession(loginData);
        for (let i = 0; i < 5; i++) {
            const response = await client.signedRequestJson('/api/counter', {});
            t.is(response.count, i + 2);
        }
        t.is(localStorageMock.getItem('sequenceNumber'), '6');
    }
    finally {
        server.close();
    }
});
test.serial('Integration: Client clears session on 401 response', async (t) => {
    localStorageMock.clear();
    const { storage, manager } = createStorageAndManager();
    const app = createAuthenticatedApp(manager);
    app.post('/api/test', (c) => {
        const session = c.get('session');
        if (!session) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
        return c.json({ ok: true });
    });
    const port = getAvailablePort();
    const server = serve({ fetch: app.fetch, port });
    const actualPort = server.address().port;
    const baseUrl = `http://localhost:${actualPort}`;
    try {
        const client = new SignedRequester(baseUrl);
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'test', password: 'password' })
        });
        const loginData = await loginResponse.json();
        client.setSession(loginData);
        const response1 = await client.signedRequestJson('/api/test', {});
        t.true(response1.ok);
        t.true(client.getSession());
        await storage.delete(loginData.sessionId);
        const response2 = await client.signedRequest('/api/test', {});
        t.is(response2.status, 401);
        t.false(client.getSession());
        t.is(localStorageMock.getItem('sessionId'), null);
    }
    finally {
        server.close();
    }
});
test.serial('Integration: Server rejects requests with wrong signature', async (t) => {
    localStorageMock.clear();
    const { manager } = createStorageAndManager();
    const app = createAuthenticatedApp(manager);
    app.post('/api/test', (c) => {
        const session = c.get('session');
        return c.json({ authenticated: !!session });
    });
    const port = getAvailablePort();
    const server = serve({ fetch: app.fetch, port });
    const actualPort = server.address().port;
    const baseUrl = `http://localhost:${actualPort}`;
    try {
        const client = new SignedRequester(baseUrl);
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'test', password: 'password' })
        });
        const loginData = await loginResponse.json();
        const wrongToken = base64urlEncode(new Uint8Array(32));
        client.setSession({
            sessionId: loginData.sessionId,
            token: wrongToken,
            sequenceNumber: loginData.sequenceNumber
        });
        const response = await client.signedRequestJson('/api/test', {});
        t.false(response.authenticated);
    }
    finally {
        server.close();
    }
});
test.serial('Integration: Server rejects expired signatures', async (t) => {
    localStorageMock.clear();
    const { storage, manager } = createStorageAndManager({
        validitySignature: 100
    });
    const app = createAuthenticatedApp(manager);
    app.post('/api/test', (c) => {
        const session = c.get('session');
        return c.json({ authenticated: !!session });
    });
    const port = getAvailablePort();
    const server = serve({ fetch: app.fetch, port });
    const actualPort = server.address().port;
    const baseUrl = `http://localhost:${actualPort}`;
    try {
        const loginResponse = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'test', password: 'password' })
        });
        const loginData = await loginResponse.json();
        const session = await storage.getBySessionId(loginData.sessionId);
        t.truthy(session);
        const oldTimestamp = Date.now() - 200;
        const parameters = [['action', 'test']];
        const parametersOrdered = [
            ['sessionId', session.id],
            ['sequenceNumber', session.sequenceNumber],
            ['timestamp', oldTimestamp],
            ...parameters
        ];
        const dataToSign = parametersOrdered
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(';');
        const signatureBytes = await hmacSha256(session.token, dataToSign);
        const signature = base64urlEncode(signatureBytes);
        const response = await fetch(`${baseUrl}/api/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: loginData.sessionId,
                timestamp: oldTimestamp,
                signature: signature,
                action: 'test'
            })
        });
        const json = await response.json();
        t.false(json.authenticated);
    }
    finally {
        server.close();
    }
});
