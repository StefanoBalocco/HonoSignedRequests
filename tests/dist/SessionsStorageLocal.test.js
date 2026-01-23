import test from 'ava';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH } from './TestHelpers.js';
test('SessionsStorageLocal: Creates session with default config', async (t) => {
    const storage = new SessionsStorageLocal();
    const session = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    t.is(typeof session.id, 'number');
    t.is(session.userId, 1);
    t.is(session.sequenceNumber, 1);
    t.true(session.token instanceof Uint8Array);
    t.is(session.token.length, DEFAULT_TOKEN_LENGTH);
    t.is(typeof session.lastUsed, 'number');
    t.deepEqual(session.data, []);
});
test('SessionsStorageLocal: Creates session with custom config', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessions: 100,
        maxSessionsPerUser: 5
    });
    const session = await storage.create(DEFAULT_VALIDITY_TOKEN, 64, 1);
    t.is(session.token.length, 64);
});
test('SessionsStorageLocal: Assigns unique session IDs', async (t) => {
    const storage = new SessionsStorageLocal();
    const sessions = await Promise.all([
        storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1),
        storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1),
        storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1)
    ]);
    const ids = sessions.map(s => s.id);
    const uniqueIds = new Set(ids);
    t.is(uniqueIds.size, 3);
});
test('SessionsStorageLocal: Enforces maxSessionsPerUser', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessionsPerUser: 2
    });
    const session1 = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    const session2 = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    const session3 = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    const userSessions = await storage.getByUserId(1);
    t.is(userSessions.length, 2);
    t.false(userSessions.some(s => s.id === session1.id));
    t.true(userSessions.some(s => s.id === session2.id));
    t.true(userSessions.some(s => s.id === session3.id));
});
test('SessionsStorageLocal: getBySessionId returns session', async (t) => {
    const storage = new SessionsStorageLocal();
    const created = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    const retrieved = await storage.getBySessionId(created.id);
    t.truthy(retrieved);
    t.is(retrieved.id, created.id);
    t.is(retrieved.userId, 1);
});
test('SessionsStorageLocal: getBySessionId returns undefined for non-existent', async (t) => {
    const storage = new SessionsStorageLocal();
    const retrieved = await storage.getBySessionId(99999);
    t.is(retrieved, undefined);
});
test('SessionsStorageLocal: getByUserId returns all user sessions', async (t) => {
    const storage = new SessionsStorageLocal();
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 2);
    const user1Sessions = await storage.getByUserId(1);
    const user2Sessions = await storage.getByUserId(2);
    t.is(user1Sessions.length, 2);
    t.is(user2Sessions.length, 1);
});
test('SessionsStorageLocal: delete removes session', async (t) => {
    const storage = new SessionsStorageLocal();
    const session = await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    const deleted = await storage.delete(session.id);
    t.true(deleted);
    const retrieved = await storage.getBySessionId(session.id);
    t.is(retrieved, undefined);
});
test('SessionsStorageLocal: delete returns false for non-existent', async (t) => {
    const storage = new SessionsStorageLocal();
    const deleted = await storage.delete(99999);
    t.false(deleted);
});
test('SessionsStorageLocal: Cleans up expired sessions', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessions: 10
    });
    const shortValidity = 100;
    const sessions = [];
    for (let i = 0; i < 8; i++) {
        sessions.push(await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, i));
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    const newSession = await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 99);
    for (const session of sessions) {
        if (session.id === newSession.id) {
            const retrieved = await storage.getBySessionId(session.id);
            t.is(retrieved?.userId, 99);
        }
        else {
            const retrieved = await storage.getBySessionId(session.id);
            t.is(retrieved, undefined);
        }
    }
});
test('SessionsStorageLocal: Throws when session array is full', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessions: 3
    });
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 1);
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 2);
    await storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 3);
    await t.throwsAsync(async () => storage.create(DEFAULT_VALIDITY_TOKEN, DEFAULT_TOKEN_LENGTH, 4), { message: 'Session array full' });
});
test('SessionsStorageLocal: Allows reuse of expired session IDs', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessions: 1
    });
    const shortValidity = 100;
    const session1 = await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 1);
    t.is(session1.id, 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    const session2 = await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 2);
    t.is(session2.id, 0);
});
test('SessionsStorageLocal: Allows creating session after expiration without error', async (t) => {
    const storage = new SessionsStorageLocal({
        maxSessions: 3
    });
    const shortValidity = 100;
    await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 1);
    await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 2);
    await storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 3);
    await new Promise(resolve => setTimeout(resolve, 150));
    await t.notThrowsAsync(async () => storage.create(shortValidity, DEFAULT_TOKEN_LENGTH, 4));
});
