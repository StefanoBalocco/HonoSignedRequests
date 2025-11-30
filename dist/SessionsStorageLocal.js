import { constantTimeEqual, hmacSha256, randomBytes, randomInt } from './Common';
export class SessionsStorageLocal {
    _primitives = new Set(['string', 'number', 'boolean']);
    _maxSessions;
    _maxSessionsPerUser;
    _cleanupSessionLimit;
    _sessionsById = new Map();
    _sessionsByUserId = new Map();
    constructor(options) {
        this._maxSessions = options?.maxSessions ?? 0xFFFF;
        this._maxSessionsPerUser = options?.maxSessionsPerUser ?? 3;
        this._cleanupSessionLimit = Math.floor(this._maxSessions * 0.75);
    }
    async validate(validitySignature, validityToken, sessionId, timestamp, parameters, signature) {
        let returnValue;
        const now = Date.now();
        if ((now > timestamp) && (now < timestamp + validitySignature)) {
            if (this._sessionsById.has(sessionId)) {
                const session = this._sessionsById.get(sessionId);
                if (now < session.lastUsed + validityToken) {
                    const parametersOrdered = [
                        ['sessionId', session.id],
                        ['sequenceNumber', session.sequenceNumber],
                        ['timestamp', timestamp],
                        ...parameters.sort((a, b) => a[0].localeCompare(b[0]))
                    ];
                    const dataToSign = parametersOrdered.map(([name, value]) => {
                        const serializedValue = (this._primitives.has(typeof value) || null === value) ? String(value) : JSON.stringify(value);
                        return `${name}=${serializedValue}`;
                    }).join(';');
                    const signatureExpected = await hmacSha256(session.token, dataToSign);
                    if (constantTimeEqual(signature, signatureExpected)) {
                        session.lastUsed = now;
                        session.sequenceNumber++;
                        returnValue = session;
                    }
                }
                else {
                    this._sessionsById.delete(sessionId);
                }
            }
        }
        return returnValue;
    }
    async create(validityToken, tokenLength, userId) {
        let returnValue;
        const now = Date.now();
        if (this._sessionsById.size > this._cleanupSessionLimit) {
            await Promise.all(Array.from(this._sessionsById.entries()).filter(([_, session]) => now > (session.lastUsed + validityToken)).map(([sessionId, _]) => this.delete(sessionId)));
        }
        const usedIds = [...this._sessionsById.keys()].filter((sessionId) => (now <= (this._sessionsById.get(sessionId).lastUsed + validityToken))).sort((a, b) => a - b);
        const sessionsRange = this._maxSessions - usedIds.length;
        if (sessionsRange > 0) {
            let sessionId = randomInt(0, this._maxSessions - usedIds.length);
            let left = 0;
            let right = usedIds.length;
            while (left < right) {
                const mid = Math.floor((left + right) / 2);
                if (usedIds[mid] <= sessionId + mid) {
                    left = mid + 1;
                }
                else {
                    right = mid;
                }
            }
            sessionId = (sessionId + left) >>> 0;
            const session = this._sessionsById.get(sessionId);
            if (session) {
                if (now > session.lastUsed + validityToken) {
                    await this.delete(sessionId);
                }
                else {
                    throw new Error(`Session ${sessionId} already in use`);
                }
            }
            const token = randomBytes(tokenLength);
            returnValue = {
                id: sessionId,
                userId,
                sequenceNumber: 1,
                token,
                lastUsed: now,
                data: []
            };
            this._sessionsById.set(sessionId, returnValue);
            const sessionsByUserId = this._sessionsByUserId.get(userId) ?? [];
            sessionsByUserId.push(returnValue);
            if (sessionsByUserId.length > this._maxSessionsPerUser) {
                const oldestIndex = sessionsByUserId.reduce((minimumIndex, session, index) => session.lastUsed < sessionsByUserId[minimumIndex].lastUsed ? index : minimumIndex, 0);
                const old = sessionsByUserId.splice(oldestIndex, 1)[0];
                this._sessionsById.delete(old.id);
            }
            this._sessionsByUserId.set(userId, sessionsByUserId);
        }
        else {
            throw new Error(`Session array full`);
        }
        return returnValue;
    }
    async delete(sessionId) {
        let returnValue = false;
        const session = this._sessionsById.get(sessionId);
        if (session) {
            returnValue = true;
            this._sessionsById.delete(sessionId);
            const userSessions = this._sessionsByUserId.get(session.userId) ?? [];
            const sessionIndex = userSessions.findIndex((session) => session.id === sessionId);
            if (-1 !== sessionIndex) {
                userSessions.splice(sessionIndex, 1);
            }
        }
        return returnValue;
    }
    async getSessionsByUserId(userId) {
        return this._sessionsByUserId.get(userId) ?? [];
    }
    async getSessionBySessionId(sessionId) {
        return this._sessionsById.get(sessionId);
    }
}
