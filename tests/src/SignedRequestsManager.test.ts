import test from 'ava';
import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { hmacSha256 } from '../../dist/Common.js';
import { Session } from '../../dist/Session.js';

// Helper to create a typed Hono app
type Env = {
	Variables: {
		session?: Session;
	};
};

function createHonoApp(): Hono<Env> {
	return new Hono<Env>();
}

function base64urlEncode( value: Uint8Array ): string {
	const base64String = Array.from( value, ( byte ) => String.fromCharCode( byte ) ).join( '' );
	return btoa( base64String )
		.replace( /\+/g, '-' )
		.replace( /\//g, '_' )
		.replace( /=+$/g, '' );
}

// Helper to create storage and manager with standard configuration
function createStorageAndManager( config?: Partial<{
	validitySignature: number;
	validityToken: number;
	tokenLength: number;
}> ) {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage, config );
	return { storage, manager };
}

// Helper to create app with authentication
function createAuthenticatedApp(
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

test('SignedRequestsManager creates session', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage, {
		validitySignature: 5000,
		validityToken: 3600000,
		tokenLength: 32
	} );
	
	const session = await manager.createSession( 1 );
	
	t.is( session.userId, 1 );
	t.is( session.sequenceNumber, 1 );
	t.is( session.token.length, 32 );
} );

test('SignedRequestsManager validates correct signature', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage );
	
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	
	// Calcola la firma corretta
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', timestamp ],
		...parameters
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signature = await hmacSha256( session.token, dataToSign );
	
	const validatedSession = await manager.validate(
		session.id,
		timestamp,
		parameters,
		signature
	);
	
	t.truthy( validatedSession );
	t.is( validatedSession!.id, session.id );
	t.is( validatedSession!.sequenceNumber, 2 ); // Incrementato dopo validazione
} );

test('SignedRequestsManager rejects invalid signature', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage );
	
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const wrongSignature = new Uint8Array( 32 ); // Wrong signature
	
	const validatedSession = await manager.validate(
		session.id,
		timestamp,
		parameters,
		wrongSignature
	);
	
	t.is( validatedSession, undefined );
} );

test('SignedRequestsManager rejects expired timestamp', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage, {
		validitySignature: 1000 // 1 secondo
	} );
	
	const session = await manager.createSession( 1 );
	const oldTimestamp = Date.now() - 2000; // 2 secondi fa
	const parameters: [ string, any ][] = [];
	
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', oldTimestamp ],
		...parameters
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signature = await hmacSha256( session.token, dataToSign );
	
	const validatedSession = await manager.validate(
		session.id,
		oldTimestamp,
		parameters,
		signature
	);
	
	t.is( validatedSession, undefined );
} );

test('SignedRequestsManager rejects future timestamp', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage );
	
	const session = await manager.createSession( 1 );
	const futureTimestamp = Date.now() + 10000; // 10 secondi nel futuro
	const parameters: [ string, any ][] = [];
	
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', futureTimestamp ],
		...parameters
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signature = await hmacSha256( session.token, dataToSign );
	
	const validatedSession = await manager.validate(
		session.id,
		futureTimestamp,
		parameters,
		signature
	);
	
	t.is( validatedSession, undefined );
} );

test('SignedRequestsManager deletes expired session during validation', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const validityToken = 100; // 100ms
	const manager = new SignedRequestsManager( storage, {
		validityToken
	} );

	const session = await manager.createSession( 1 );

	// Simula che la sessione sia scaduta modificando lastUsed
	session.lastUsed = Date.now() - validityToken - 50;

	const timestamp = Date.now();
	const parameters: [ string, any ][] = [];
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', timestamp ],
		...parameters
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signature = await hmacSha256( session.token, dataToSign );

	const validatedSession = await manager.validate(
		session.id,
		timestamp,
		parameters,
		signature
	);

	t.is( validatedSession, undefined );

	// Verify that the session was deleted
	const retrieved = await storage.getBySessionId( session.id );
	t.is( retrieved, undefined );
} );

test('SignedRequestsManager middleware validates POST request', async ( t ) => {
	const app = createHonoApp();
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage );

	app.use( '/api/*', manager.middleware );
	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );
	
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters = { action: 'test' };
	
	const parametersOrdered = [
		[ 'sessionId', session.id ],
		[ 'sequenceNumber', session.sequenceNumber ],
		[ 'timestamp', timestamp ],
		[ 'action', 'test' ]
	];
	const dataToSign = parametersOrdered
		.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
		.join( ';' );
	const signatureBytes = await hmacSha256( session.token, dataToSign );
	const signature = base64urlEncode( signatureBytes );
	
	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature,
			...parameters
		} )
	} );
	
	const json = await res.json() as { authenticated: boolean; userId: number };
	
	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test('SignedRequestsManager middleware rejects invalid signature', async ( t ) => {
	const app = createHonoApp();
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage );

	app.use( '/api/*', manager.middleware );
	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );
	
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	
	// Use a valid base64url signature but with wrong content
	const wrongSignature = base64urlEncode( new Uint8Array( 32 ) );

	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature: wrongSignature
		} )
	} );
	
	const json = await res.json() as { authenticated: boolean };
	
	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

test('SignedRequestsManager uses default storage if none provided', async ( t ) => {
	const manager = new SignedRequestsManager();

	const session = await manager.createSession( 1 );

	t.truthy( session );
	t.is( session.userId, 1 );
} );

// ============================================================================
// Integration Tests: Server + Client
// ============================================================================

import { serve } from '@hono/node-server';
import { SignedRequester } from '../../client/dist/SignedRequester.js';
import type { AddressInfo } from 'node:net';

// Mock localStorage for Node.js (required for the client)
class LocalStorageMock {
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

const localStorageMock = new LocalStorageMock();
( global as any ).localStorage = localStorageMock;

// Helper to get an available port
function getAvailablePort(): number {
	// Use random ports between 3000 and 4000 to avoid conflicts
	return 3000 + Math.floor( Math.random() * 1000 );
}

test.serial('Integration: Client can authenticate and make signed requests', async ( t ) => {
	localStorageMock.clear();

	// Setup server with helper
	const { manager } = createStorageAndManager();
	const app = createAuthenticatedApp( manager );

	// Protected endpoints
	app.post( '/api/ping', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { pong: !!session } );
	} );

	app.post( '/api/protected', ( c ) => {
		const session = c.get( 'session' );
		if( !session ) {
			return c.json( { error: 'Unauthorized' }, 401 );
		}
		return c.json( { message: 'Success', userId: session.userId } );
	} );

	// Start server on random port
	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
		// Setup client
		const client = new SignedRequester( baseUrl );

		// Test login
		const loginResponse = await fetch( `${ baseUrl }/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { username: 'test', password: 'password' } )
		} );

		t.is( loginResponse.status, 200 );
		const loginData = await loginResponse.json() as {
			sessionId: number;
			token: string;
			sequenceNumber: number;
		};

		t.truthy( loginData.sessionId );
		t.truthy( loginData.token );
		t.is( loginData.sequenceNumber, 1 );

		// Configure session in the client
		client.setSession( {
			sessionId: loginData.sessionId,
			token: loginData.token,
			sequenceNumber: loginData.sequenceNumber
		} );

		// Test ping with signed request
		const pingResponse = await client.signedRequestJson<{ pong: boolean }>( '/api/ping', {} );
		t.true( pingResponse.pong );

		// Test protected endpoint
		const protectedResponse = await client.signedRequestJson<{
			message: string;
			userId: number;
		}>( '/api/protected', {} );

		t.is( protectedResponse.message, 'Success' );
		t.is( protectedResponse.userId, 1 );

		// Verify that the sequence has been incremented
		t.is( localStorageMock.getItem( 'sequenceNumber' ), '3' );
	} finally {
		// Close server
		server.close();
	}
} );

test.serial('Integration: Client handles multiple sequential requests correctly', async ( t ) => {
	localStorageMock.clear();

	// Setup server with helper
	const { manager } = createStorageAndManager();
	const app = createAuthenticatedApp( manager );

	app.post( '/api/counter', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { count: session?.sequenceNumber || 0 } );
	} );

	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
		const client = new SignedRequester( baseUrl );

		// Login
		const loginResponse = await fetch( `${ baseUrl }/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { username: 'test', password: 'password' } )
		} );

		const loginData = await loginResponse.json() as {
			sessionId: number;
			token: string;
			sequenceNumber: number;
		};

		client.setSession( loginData );

		// Make 5 sequential requests
		for( let i = 0; i < 5; i++ ) {
			const response = await client.signedRequestJson<{ count: number }>(
				'/api/counter',
				{}
			);
			// The server sees sequenceNumber after the increment
			t.is( response.count, i + 2 );
		}

		// Verify that sequenceNumber was incremented correctly
		t.is( localStorageMock.getItem( 'sequenceNumber' ), '6' );
	} finally {
		server.close();
	}
} );

test.serial('Integration: Client clears session on 401 response', async ( t ) => {
	localStorageMock.clear();

	// Setup server with helper
	const { storage, manager } = createStorageAndManager();
	const app = createAuthenticatedApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		if( !session ) {
			return c.json( { error: 'Unauthorized' }, 401 );
		}
		return c.json( { ok: true } );
	} );

	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
		const client = new SignedRequester( baseUrl );

		// Login
		const loginResponse = await fetch( `${ baseUrl }/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { username: 'test', password: 'password' } )
		} );

		const loginData = await loginResponse.json() as {
			sessionId: number;
			token: string;
			sequenceNumber: number;
		};

		client.setSession( loginData );

		// First request: OK
		const response1 = await client.signedRequestJson<{ ok: boolean }>(
			'/api/test',
			{}
		);
		t.true( response1.ok );
		t.true( client.getSession() );

		// Delete the session on the server
		await storage.delete( loginData.sessionId );

		// Second request: should receive 401 and clearSession
		const response2 = await client.signedRequest( '/api/test', {} );
		t.is( response2.status, 401 );

		// Verify that the session was cleared
		t.false( client.getSession() );
		t.is( localStorageMock.getItem( 'sessionId' ), null );
	} finally {
		server.close();
	}
} );

test.serial('Integration: Server rejects requests with wrong signature', async ( t ) => {
	localStorageMock.clear();

	// Setup server with helper
	const { manager } = createStorageAndManager();
	const app = createAuthenticatedApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
		const client = new SignedRequester( baseUrl );

		// Login
		const loginResponse = await fetch( `${ baseUrl }/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { username: 'test', password: 'password' } )
		} );

		const loginData = await loginResponse.json() as {
			sessionId: number;
			token: string;
			sequenceNumber: number;
		};

		// Configure session with wrong token
		const wrongToken = base64urlEncode( new Uint8Array( 32 ) );
		client.setSession( {
			sessionId: loginData.sessionId,
			token: wrongToken,
			sequenceNumber: loginData.sequenceNumber
		} );

		// The request should fail because the signature is wrong
		const response = await client.signedRequestJson<{ authenticated: boolean }>(
			'/api/test',
			{}
		);

		t.false( response.authenticated );
	} finally {
		server.close();
	}
} );

test.serial('Integration: Server rejects expired signatures', async ( t ) => {
	localStorageMock.clear();

	// Setup server with very short signature validity
	const { storage, manager } = createStorageAndManager( {
		validitySignature: 100 // 100ms
	} );
	const app = createAuthenticatedApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
		// Login
		const loginResponse = await fetch( `${ baseUrl }/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { username: 'test', password: 'password' } )
		} );

		const loginData = await loginResponse.json() as {
			sessionId: number;
			token: string;
			sequenceNumber: number;
		};

		const session = await storage.getBySessionId( loginData.sessionId );
		t.truthy( session );

		// Create a signature manually with old timestamp
		const oldTimestamp = Date.now() - 200; // 200ms ago
		const parameters = [ [ 'action', 'test' ] ];
		const parametersOrdered = [
			[ 'sessionId', session!.id ],
			[ 'sequenceNumber', session!.sequenceNumber ],
			[ 'timestamp', oldTimestamp ],
			...parameters
		];
		const dataToSign = parametersOrdered
			.map( ( [ name, value ] ) => `${ name }=${ String( value ) }` )
			.join( ';' );
		const signatureBytes = await hmacSha256( session!.token, dataToSign );
		const signature = base64urlEncode( signatureBytes );

		// Make request with expired signature
		const response = await fetch( `${ baseUrl }/api/test`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				sessionId: loginData.sessionId,
				timestamp: oldTimestamp,
				signature: signature,
				action: 'test'
			} )
		} );

		const json = await response.json() as { authenticated: boolean };
		t.false( json.authenticated );
	} finally {
		server.close();
	}
} );
