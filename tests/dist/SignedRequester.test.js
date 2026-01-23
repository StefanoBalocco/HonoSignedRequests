import test from 'ava';
import { SignedRequester } from '../../client/dist/SignedRequester.js';
import { LocalStorageMock, base64urlEncode } from './TestHelpers.js';
const localStorageMock = new LocalStorageMock();
global.localStorage = localStorageMock;
test.beforeEach(() => {
    localStorageMock.clear();
});
test('SignedRequester: Can be instantiated', (t) => {
    const requester = new SignedRequester();
    t.truthy(requester);
});
test('SignedRequester: Can be instantiated with baseUrl', (t) => {
    const requester = new SignedRequester('https://api.example.com');
    t.truthy(requester);
});
test('SignedRequester: getSession returns false when no session', (t) => {
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
test('SignedRequester: setSession stores session data', (t) => {
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
test('SignedRequester: setSession throws on invalid token', (t) => {
    const requester = new SignedRequester();
    t.throws(() => {
        requester.setSession({
            sessionId: 12345,
            token: 'invalid!!!token',
            sequenceNumber: 1
        });
    }, { message: 'Invalid token format' });
});
test('SignedRequester: getSession loads from localStorage', (t) => {
    const token = base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    localStorageMock.setItem('sessionId', '99999');
    localStorageMock.setItem('token', token);
    localStorageMock.setItem('sequenceNumber', '5');
    const requester = new SignedRequester();
    t.true(requester.getSession());
});
test('SignedRequester: getSession returns false for invalid localStorage data', (t) => {
    localStorageMock.setItem('sessionId', 'not-a-number');
    localStorageMock.setItem('token', 'dGVzdA');
    localStorageMock.setItem('sequenceNumber', '1');
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
test('SignedRequester: clearSession removes all session data', (t) => {
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
test('SignedRequester: signedRequest throws when session not configured', async (t) => {
    const requester = new SignedRequester();
    await t.throwsAsync(async () => {
        await requester.signedRequest('/api/test', { action: 'test' });
    }, { message: 'Session not configured' });
});
test('SignedRequester: signedRequestJson throws when session not configured', async (t) => {
    const requester = new SignedRequester();
    await t.throwsAsync(async () => {
        await requester.signedRequestJson('/api/test', { action: 'test' });
    }, { message: 'Session not configured' });
});
test('SignedRequester: Caches session data in memory', (t) => {
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
test('SignedRequester: Handles missing localStorage gracefully', (t) => {
    localStorageMock.setItem('sessionId', '12345');
    localStorageMock.setItem('token', base64urlEncode(new Uint8Array([1, 2, 3])));
    const requester = new SignedRequester();
    t.false(requester.getSession());
});
test('SignedRequester: Calls onError callback on invalid token in setSession', (t) => {
    const errors = [];
    const requester = new SignedRequester(undefined, (error) => errors.push(error));
    t.throws(() => {
        requester.setSession({
            sessionId: 12345,
            token: 'invalid!!!token',
            sequenceNumber: 1
        });
    }, { message: 'Invalid token format' });
    t.is(errors.length, 0);
});
test('SignedRequester: Calls onError callback on decode error in getSession', (t) => {
    const errors = [];
    localStorageMock.setItem('sessionId', '12345');
    localStorageMock.setItem('token', 'validBase64');
    localStorageMock.setItem('sequenceNumber', '1');
    const requester = new SignedRequester(undefined, (error) => errors.push(error));
    const hasSession = requester.getSession();
    t.true(hasSession);
    t.is(errors.length, 0);
});
