import test from 'ava';
import { constantTimeEqual, fromBase64Url, hmacSha256, randomBytes, randomInt } from '../../dist/Common.js';
test('Common: fromBase64Url converts base64url to Uint8Array', (t) => {
    const base64url = 'SGVsbG8gV29ybGQ';
    const result = fromBase64Url(base64url);
    t.true(result instanceof Uint8Array);
    t.is(result.length, 11);
    t.is(String.fromCharCode(...result), 'Hello World');
});
test('Common: fromBase64Url handles padding correctly', (t) => {
    const base64url = 'dGVzdA';
    const result = fromBase64Url(base64url);
    t.is(String.fromCharCode(...result), 'test');
});
test('Common: randomBytes generates correct length', (t) => {
    const bytes = randomBytes(32);
    t.true(bytes instanceof Uint8Array);
    t.is(bytes.length, 32);
});
test('Common: randomBytes generates different values', (t) => {
    const bytes1 = randomBytes(16);
    const bytes2 = randomBytes(16);
    t.false(constantTimeEqual(bytes1, bytes2));
});
test('Common: randomInt generates number in range', (t) => {
    const min = 100;
    const max = 200;
    for (let i = 0; i < 100; i++) {
        const num = randomInt(min, max);
        t.true(num >= min && num < max);
    }
});
test('Common: randomInt throws on invalid range', (t) => {
    t.throws(() => randomInt(100, 100), { message: 'max must be > min' });
    t.throws(() => randomInt(200, 100), { message: 'max must be > min' });
});
test('Common: constantTimeEqual returns true for equal arrays', (t) => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    t.true(constantTimeEqual(a, b));
});
test('Common: constantTimeEqual returns false for different arrays', (t) => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    t.false(constantTimeEqual(a, b));
});
test('Common: constantTimeEqual returns false for different lengths', (t) => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    t.false(constantTimeEqual(a, b));
});
test('Common: hmacSha256 generates correct signature', async (t) => {
    const key = new Uint8Array(32);
    const data = 'test message';
    const signature = await hmacSha256(key, data);
    t.true(signature instanceof Uint8Array);
    t.is(signature.length, 32);
});
test('Common: hmacSha256 produces consistent signatures', async (t) => {
    const key = new Uint8Array([1, 2, 3, 4]);
    const data = 'consistent test';
    const sig1 = await hmacSha256(key, data);
    const sig2 = await hmacSha256(key, data);
    t.true(constantTimeEqual(sig1, sig2));
});
test('Common: hmacSha256 produces different signatures for different keys', async (t) => {
    const key1 = new Uint8Array([1, 2, 3, 4]);
    const key2 = new Uint8Array([5, 6, 7, 8]);
    const data = 'test';
    const sig1 = await hmacSha256(key1, data);
    const sig2 = await hmacSha256(key2, data);
    t.false(constantTimeEqual(sig1, sig2));
});
