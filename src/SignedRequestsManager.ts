import { Context, MiddlewareHandler, Next } from 'hono';
import { constantTimeEqual, fromBase64Url, hmacSha256, Undefinedable } from './Common.js';
import { Session } from './Session.js';
import { SessionsStorage } from './SessionsStorage.js';
import { SessionsStorageLocal } from './SessionsStorageLocal.js';

type SignedRequestsManagerConfig = {
	validitySignature: number;
	validityToken: number;
	tokenLength: number;
};

export class SignedRequestsManager {
	private static readonly _primitives: Set<string> = new Set( [ 'string', 'number', 'boolean' ] );
	private readonly _storage: SessionsStorage;
	private readonly _validitySignature: number;
	private readonly _validityToken: number;
	private readonly _tokenLength: number;

	constructor( storage?: SessionsStorage, options?: Partial<SignedRequestsManagerConfig> ) {
		this._validitySignature = options?.validitySignature ?? 5000;
		this._validityToken = options?.validityToken ?? 60 * 60000;
		this._tokenLength = options?.tokenLength ?? 32;

		if( !storage ) {
			storage = new SessionsStorageLocal();
		}
		this._storage = storage;
	}

	async createSession( userId: number ): Promise<Session> {
		return await this._storage.create( this._validityToken, this._tokenLength, userId );
	}

	async validate(
		sessionId: number,
		timestamp: number,
		parameters: [ string, any ][],
		signature: Uint8Array<ArrayBuffer>
	): Promise<Undefinedable<Session>> {
		let returnValue: Undefinedable<Session>;
		const now: number = Date.now();
		if( ( now > timestamp ) && ( now < timestamp + this._validitySignature ) ) {
			const session: Undefinedable<Session> = await this._storage.getBySessionId( sessionId );
			if( session ) {
				if( now < session.lastUsed + this._validityToken ) {
					const parametersOrdered: [ string, any ][] = [
						[ 'sessionId', session.id ],
						[ 'sequenceNumber', session.sequenceNumber ],
						[ 'timestamp', timestamp ],
						...parameters.sort(
							( a: [ string, string | number ], b: [ string, string | number ] ): number => a[ 0 ].localeCompare( b[ 0 ] )
						)
					];
					const dataToSign: string = parametersOrdered.map(
						( [ name, value ]: [ string, any ] ): string => {
							const serializedValue: string = ( SignedRequestsManager._primitives.has( typeof value ) || null === value ) ? String( value ) : JSON.stringify( value );
							return `${ name }=${ serializedValue }`;
						}
					).join( ';' );
					const signatureExpected: Uint8Array<ArrayBuffer> = await hmacSha256( session.token, dataToSign );
					if( constantTimeEqual( signature, signatureExpected ) ) {
						session.lastUsed = now;
						session.sequenceNumber++;
						returnValue = session;
					}
				} else {
					await this._storage.delete( sessionId );
				}
			}
		}
		return returnValue;
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
				// Remove sessionId, timestamp, and signature from parameters before validation
				const { sessionId: _, timestamp: __, signature: ___, ...other } = parameters;

				// Convert to array of tuples for sessionValidate
				const otherParameters: [ string, string ][] = Object.entries( other );

				session = await this.validate(
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