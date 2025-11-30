import { Undefinedable } from './Common';
import { Session } from './Session';

export abstract class SessionsStorage {
	abstract create(
		validityToken: number,
		tokenLength: number,
		userId: number
	): Promise<Session>;

	abstract get(
		sessionId: number
	): Promise<Undefinedable<Session>>;

	abstract delete(
		sessionId: number
	): Promise<boolean>;
}