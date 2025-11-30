import { fromBase64Url } from './Common';
import { SessionsStorageLocal } from './SessionsStorageLocal';
export class SignedRequestsManager {
    _storage;
    constructor(storage) {
        if (!storage) {
            storage = new SessionsStorageLocal();
        }
        this._storage = storage;
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
                session = await this._storage.validate(sessionId, timestamp, otherParameters, signature);
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
