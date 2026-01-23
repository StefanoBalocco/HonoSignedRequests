import { Undefinedable } from './Common.js';
import { Session } from './Session.js';
export declare abstract class SessionsStorage {
    abstract create(validityToken: number, tokenLength: number, userId: number): Promise<Session>;
    abstract getBySessionId(sessionId: number): Promise<Undefinedable<Session>>;
    abstract getByUserId(userId: number): Promise<Session[]>;
    abstract delete(sessionId: number): Promise<boolean>;
}
