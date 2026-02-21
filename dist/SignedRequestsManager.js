import { base64UrlVerify, constantTimeEqual, fromBase64Url, hmacSha256 } from './Common.js';
import { SessionsStorageLocal } from './SessionsStorageLocal.js';
export class SignedRequestsManager {
    static _primitives = new Set(['string', 'number', 'boolean']);
    _storage;
    _validitySignature;
    _validityToken;
    _tokenLength;
    _onError;
    constructor(storage, options) {
        this._validitySignature = options?.validitySignature ?? 5000;
        this._validityToken = options?.validityToken ?? 60 * 60000;
        this._tokenLength = options?.tokenLength ?? 32;
        this._onError = options?.onError;
        if (!storage) {
            storage = new SessionsStorageLocal();
        }
        this._storage = storage;
    }
    async createSession(userId) {
        return await this._storage.create(this._validityToken, this._tokenLength, userId);
    }
    async validate(sessionId, timestamp, parameters, signature) {
        let returnValue;
        const now = Date.now();
        if ((now > timestamp) && (now < timestamp + this._validitySignature)) {
            const session = await this._storage.getBySessionId(sessionId);
            if (session) {
                if (now < session.lastUsed + this._validityToken) {
                    const parametersOrdered = [
                        ['sessionId', session.id],
                        ['sequenceNumber', session.sequenceNumber],
                        ['timestamp', timestamp],
                        ...parameters.sort((a, b) => a[0].localeCompare(b[0]))
                    ];
                    const dataToSign = parametersOrdered.map(([name, value]) => {
                        const serializedValue = (SignedRequestsManager._primitives.has(typeof value) || null === value) ? String(value) : JSON.stringify(value);
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
                    await this._storage.delete(sessionId);
                }
            }
        }
        return returnValue;
    }
    middleware = async (context, next) => {
        let session;
        try {
            const parameters = {};
            switch (context.req.method) {
                case 'GET':
                case 'HEAD': {
                    Object.assign(parameters, context.req.query());
                    break;
                }
                case 'POST':
                case 'PUT':
                case 'DELETE':
                case 'PATCH': {
                    switch (context.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()) {
                        case 'application/json': {
                            Object.assign(parameters, await context.req.json());
                            break;
                        }
                        case 'multipart/form-data':
                        case 'application/x-www-form-urlencoded': {
                            Object.assign(parameters, await context.req.parseBody());
                            break;
                        }
                    }
                }
            }
            const sessionId = parseInt(parameters.sessionId, 10);
            const timestamp = parseInt(parameters.timestamp, 10);
            if (sessionId && timestamp) {
                if (parameters.signature) {
                    if (base64UrlVerify.test(parameters.signature)) {
                        const signature = fromBase64Url(parameters.signature);
                        const { sessionId: _, timestamp: __, signature: ___, ...other } = parameters;
                        const otherParameters = Object.entries(other);
                        session = await this.validate(sessionId, timestamp, otherParameters, signature);
                    }
                    else {
                        throw new Error('Invalid signature format');
                    }
                }
            }
        }
        catch (error) {
            this._onError?.(error);
        }
        if (session) {
            context.set('session', session);
        }
        await next();
    };
}
