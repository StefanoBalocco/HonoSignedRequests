import { Undefinedable } from './Common';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';
type SessionStorageLocalConfig = {
    maxSessions: number;
    maxSessionsPerUser: number;
    validitySignature: number;
    validityToken: number;
    tokenLength: number;
};
export declare class SessionsStorageLocal implements SessionsStorage {
    private readonly _primitives;
    private readonly _maxSessions;
    private readonly _maxSessionsPerUser;
    private readonly _cleanupSessionLimit;
    private readonly _validitySignature;
    private readonly _validityToken;
    private readonly _tokenLength;
    private _sessionsById;
    private _sessionsByUserId;
    constructor(options?: Partial<SessionStorageLocalConfig>);
    validate(sessionId: number, timestamp: number, parameters: [string, any][], signature: Uint8Array<ArrayBuffer>): Promise<Undefinedable<Session>>;
    create(userId: number): Promise<Session>;
    delete(sessionId: number): Promise<boolean>;
    getSessionsByUserId(userId: number): Promise<Session[]>;
    getSessionBySessionId(sessionId: number): Promise<Undefinedable<Session>>;
}
export {};
