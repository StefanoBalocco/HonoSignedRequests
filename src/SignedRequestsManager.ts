import { Context, MiddlewareHandler, Next } from 'hono';
import { fromBase64Url, Undefinedable } from './Common';
import { Session } from './Session';
import { SessionsStorage } from './SessionsStorage';
import { SessionsStorageLocal } from './SessionsStorageLocal';

export class SignedRequestsManager {
	private readonly _storage: SessionsStorage;

	constructor( storage?: SessionsStorage ) {
		if( !storage ) {
			storage = new SessionsStorageLocal();
		}
		this._storage = storage;
	}

	middleware: MiddlewareHandler = async( context: Context<{ Variables: { session?: Session } }>, next: Next ): Promise<void> => {
		let session: Undefinedable<Session>;

		try {
			const parameters: Record<string, string> = {};

			switch( context.req.method ) {
				case 'GET': {
					Object.assign( parameters, context.req.query() );
					break;
				}
				case 'POST': {
					switch( context.req.header( 'Content-Type' ) ) {
						case 'application/json': {
							Object.assign( parameters, await context.req.json() );
							break;
						}
						default: {
							Object.assign( parameters, await context.req.parseBody() );
							break;
						}
					}
				}
			}

			const sessionId: number = parseInt( parameters.sessionId, 10 );
			const timestamp: number = parseInt( parameters.timestamp, 10 );
			const signature: Uint8Array<ArrayBuffer> = fromBase64Url( parameters.signature );

			if( sessionId && timestamp && signature ) {
				// Rimuove sessionId, timestamp e signature dai parametri prima di validare
				const { sessionId: _, timestamp: __, signature: ___, ...other } = parameters;

				// Converte in array di tuple per sessionValidate
				const otherParameters: [ string, string ][] = Object.entries( other );

				session = await this._storage.validate(
					sessionId,
					timestamp,
					otherParameters,
					signature
				);
			}
		} catch( error ) {
			console.error( 'Session validation error:', error );
		}

		if( session ) {
			context.set( 'session', session );
		}

		await next();
	};
}