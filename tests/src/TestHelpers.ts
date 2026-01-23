import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { hmacSha256 } from '../../dist/Common.js';
import { Session } from '../../dist/Session.js';

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_VALIDITY_TOKEN = 3600000;
export const DEFAULT_TOKEN_LENGTH = 32;

// ============================================================================
// Types
// ============================================================================

export type Env = {
	Variables: {
		session?: Session;
	};
};

// ============================================================================
// LocalStorage Mock
// ============================================================================

export class LocalStorageMock {
	private store: Map<string, string> = new Map();

	getItem( key: string ): string | null {
		return this.store.get( key ) || null;
	}

	setItem( key: string, value: string ): void {
		this.store.set( key, value );
	}

	removeItem( key: string ): void {
		this.store.delete( key );
	}

	clear(): void {
		this.store.clear();
	}
}

// ============================================================================
// Encoding Helpers
// ============================================================================

export function base64urlEncode( value: Uint8Array ): string {
	const base64String = Array.from( value, ( byte ) => String.fromCharCode( byte ) ).join( '' );
	return btoa( base64String )
		.replace( /\+/g, '-' )
		.replace( /\//g, '_' )
		.replace( /=+$/, '' );
}

// ============================================================================
// Signature Helpers
// ============================================================================

export async function createSignature(
	session: Session,
	timestamp: number,
	parameters: [ string, any ][] = []
): Promise<{ signature: Uint8Array<ArrayBuffer>; signatureBase64: string }> {
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', timestamp ],
		...parameters.sort(
			( a: [ string, any ], b: [ string, any ] ): number => a[ 0 ].localeCompare( b[ 0 ] )
		)
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signature = await hmacSha256( session.token, dataToSign );
	return {
		signature,
		signatureBase64: base64urlEncode( signature )
	};
}

// ============================================================================
// Hono App Helpers
// ============================================================================

export function createHonoApp(): Hono<Env> {
	return new Hono<Env>();
}

export function createStorageAndManager( config?: Partial<{
	validitySignature: number;
	validityToken: number;
	tokenLength: number;
	onError: ( error: unknown ) => void;
}> ) {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage, config );
	return { storage, manager };
}

export function createMiddlewareApp( manager: SignedRequestsManager, path: string = '/api/*' ): Hono<Env> {
	const app = createHonoApp();
	app.use( path, manager.middleware );
	return app;
}

export function createAuthenticatedApp(
	manager: SignedRequestsManager,
	options: {
		loginEndpoint?: string;
		protectedPaths?: string;
	} = {}
) {
	const app = createHonoApp();
	const { loginEndpoint = '/auth/login', protectedPaths = '/api/*' } = options;

	// Login endpoint (unprotected)
	app.post( loginEndpoint, async ( c ) => {
		const body = await c.req.json().catch( () => ( {} ) );
		const { username, password } = body;

		// Mock authentication for tests
		if( username === 'test' && password === 'password' ) {
			const session = await manager.createSession( 1 );
			const tokenBase64 = base64urlEncode( session.token );

			return c.json( {
				sessionId: session.id,
				token: tokenBase64,
				sequenceNumber: session.sequenceNumber
			} );
		}

		return c.json( { error: 'Invalid credentials' }, 401 );
	} );

	// Middleware for protected paths
	app.use( protectedPaths, manager.middleware );

	return app;
}

// ============================================================================
// Network Helpers
// ============================================================================

export function getAvailablePort(): number {
	// Use random ports between 3000 and 4000 to avoid conflicts
	return 3000 + Math.floor( Math.random() * 1000 );
}
