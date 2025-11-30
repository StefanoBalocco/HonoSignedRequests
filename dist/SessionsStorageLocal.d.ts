import { Undefinedable } from './Common';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';
type SessionStorageLocalConfig = {
    maxSessions: number;
    maxSessionsPerUser: number;
};
export declare class SessionsStorageLocal implements SessionsStorage {
    private readonly _maxSessions;
    private readonly _maxSessionsPerUser;
    private readonly _cleanupSessionLimit;
    private _sessionsById;
    private _sessionsByUserId;
    constructor(options?: Partial<SessionStorageLocalConfig>);
    create(validityToken: number, tokenLength: number, userId: number): Promise<Session>;
    delete(sessionId: number): Promise<boolean>;
    getByUserId(userId: number): Promise<Session[]>;
    getBySessionId(sessionId: number): Promise<Undefinedable<Session>>;
}
export {};
