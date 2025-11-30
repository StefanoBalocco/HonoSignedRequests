import { fromBase64Url } from './Common';
import { SessionsStorageLocal } from './SessionsStorageLocal';
export class SignedRequestsManager {
    _storage;
    _validitySignature;
    _validityToken;
    _tokenLength;
    constructor(storage, options) {
        this._validitySignature = options?.validitySignature ?? 5000;
        this._validityToken = options?.validityToken ?? 60 * 60000;
        this._tokenLength = options?.tokenLength ?? 32;
        if (!storage) {
            storage = new SessionsStorageLocal();
        }
        this._storage = storage;
    }
    async createSession(userId) {
        return await this._storage.create(this._validityToken, this._tokenLength, userId);
    }
    middleware = async (context, next) => {
        let session;
        try {
            const parameters = {};
            switch (context.req.method) {
                case 'GET': {
                    Object.assign(parameters, context.req.query());
                    break;
                }
                case 'POST': {
                    switch (context.req.header('Content-Type')) {
                        case 'application/json': {
                            Object.assign(parameters, await context.req.json());
                            break;
                        }
                        default: {
                            Object.assign(parameters, await context.req.parseBody());
                            break;
                        }
                    }
                }
            }
            const sessionId = parseInt(parameters.sessionId, 10);
            const timestamp = parseInt(parameters.timestamp, 10);
            const signature = fromBase64Url(parameters.signature);
            if (sessionId && timestamp && signature) {
                const { sessionId: _, timestamp: __, signature: ___, ...other } = parameters;
                const otherParameters = Object.entries(other);
                session = await this._storage.validate(this._validitySignature, this._validityToken, sessionId, timestamp, otherParameters, signature);
            }
        }
        catch (error) {
            console.error('Session validation error:', error);
        }
        if (session) {
            context.set('session', session);
        }
        await next();
    };
}
