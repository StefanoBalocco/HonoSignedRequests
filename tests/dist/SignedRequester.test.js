import test from 'ava';
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
function base64urlEncode(value) {
    const base64String = Array.from(value, (byte) => String.fromCharCode(byte)).join('');
    return btoa(base64String)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
test.beforeEach(() => {
    localStorageMock.clear();
});
test('SignedRequester can be instantiated', (t) => {
    const requester = new SignedRequester();
    t.truthy(requester);
});
test('SignedRequester can be instantiated with baseUrl', (t) => {
    const requester = new SignedRequester('https://api.example.com');
    t.truthy(requester);
});
test('SignedRequester.getSession returns false when no session', (t) => {
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
test('SignedRequester.setSession stores session data', (t) => {
    const requester = new SignedRequester();
    const token = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    requester.setSession({
        sessionId: 12345,
        token: token,
        sequenceNumber: 1
    });
    t.true(requester.getSession());
    t.is(localStorageMock.getItem('sessionId'), '12345');
    t.is(localStorageMock.getItem('token'), token);
    t.is(localStorageMock.getItem('sequenceNumber'), '1');
});
test('SignedRequester.setSession throws on invalid token', (t) => {
    const requester = new SignedRequester();
    t.throws(() => {
        requester.setSession({
            sessionId: 12345,
            token: 'invalid!!!token',
            sequenceNumber: 1
        });
    }, { message: 'Invalid token format' });
});
test('SignedRequester.getSession loads from localStorage', (t) => {
    const token = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    localStorageMock.setItem('sessionId', '99999');
    localStorageMock.setItem('token', token);
    localStorageMock.setItem('sequenceNumber', '5');
    const requester = new SignedRequester();
    t.true(requester.getSession());
});
test('SignedRequester.getSession returns false for invalid localStorage data', (t) => {
    localStorageMock.setItem('sessionId', 'not-a-number');
    localStorageMock.setItem('token', 'dGVzdA');
    localStorageMock.setItem('sequenceNumber', '1');
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
test('SignedRequester.clearSession removes all session data', (t) => {
    const requester = new SignedRequester();
    const token = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    requester.setSession({
        sessionId: 12345,
        token: token,
        sequenceNumber: 1
    });
    t.true(requester.getSession());
    requester.clearSession();
    t.false(requester.getSession());
    t.is(localStorageMock.getItem('sessionId'), null);
    t.is(localStorageMock.getItem('token'), null);
    t.is(localStorageMock.getItem('sequenceNumber'), null);
});
test('SignedRequester.signedRequest throws when session not configured', async (t) => {
    const requester = new SignedRequester();
    await t.throwsAsync(async () => {
        await requester.signedRequest('/api/test', { action: 'test' });
    }, { message: 'Session not configured' });
});
test('SignedRequester.signedRequestJson throws when session not configured', async (t) => {
    const requester = new SignedRequester();
    await t.throwsAsync(async () => {
        await requester.signedRequestJson('/api/test', { action: 'test' });
    }, { message: 'Session not configured' });
});
test('SignedRequester caches session data in memory', (t) => {
    const requester = new SignedRequester();
    const token = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    requester.setSession({
        sessionId: 12345,
        token: token,
        sequenceNumber: 1
    });
    localStorageMock.clear();
    t.true(requester.getSession());
});
test('SignedRequester handles missing localStorage gracefully', (t) => {
    localStorageMock.setItem('sessionId', '12345');
    localStorageMock.setItem('token', base64urlEncode(new Uint8Array([1, 2, 3])));
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
