import { Undefinedable } from './Common';
import { Session } from './Session';

export abstract class SessionsStorage {
	abstract validate(
		validitySignature: number,
		validityToken: number,
		sessionId: number,
		timestamp: number,
		parameters: [ string, any ][],
		signature: Uint8Array<ArrayBuffer>
	): Promise<Undefinedable<Session>>;

	abstract create(
		validityToken: number,
		tokenLength: number,
		userId: number
	): Promise<Session>;
}