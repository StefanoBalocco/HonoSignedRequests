import { Undefinedable } from './Common';
import { Session } from './Session';
export declare abstract class SessionsStorage {
    abstract validate(sessionId: number, timestamp: number, parameters: [string, any][], signature: Uint8Array<ArrayBuffer>): Promise<Undefinedable<Session>>;
    abstract create(userId: number): Promise<Session>;
}
