import test from 'ava';
import { Hono } from 'hono';
import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { hmacSha256 } from '../../dist/Common.js';
import { Session } from '../../dist/Session.js';

// Helper per creare un'app Hono tipizzata
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

// Helper per creare storage e manager con configurazione standard
function createStorageAndManager( config?: Partial<{
	validitySignature: number;
	validityToken: number;
	tokenLength: number;
}> ) {
	const storage = new SessionsStorageLocal();
	const manager = new SignedRequestsManager( storage, config );
	return { storage, manager };
}

// Helper per creare app con autenticazione
function createAuthenticatedApp(
	manager: SignedRequestsManager,
	options: {
		loginEndpoint?: string;
		protectedPaths?: string;
	} = {}
) {
	const app = createHonoApp();
	const { loginEndpoint = '/auth/login', protectedPaths = '/api/*' } = options;

	// Login endpoint (non protetto)
	app.post( loginEndpoint, async ( c ) => {
		const body = await c.req.json().catch( () => ( {} ) );
		const { username, password } = body;

		// Mock authentication per test
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

	// Middleware per path protetti
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
	const wrongSignature = new Uint8Array( 32 ); // Firma sbagliata
	
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

	// Verifica che la sessione sia stata cancellata
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
	
	// Usa una signature base64url valida ma con contenuto sbagliato
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

// Mock localStorage per Node.js (necessario per il client)
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

// Helper per ottenere una porta disponibile
function getAvailablePort(): number {
	// Usa porte random tra 3000 e 4000 per evitare conflitti
	return 3000 + Math.floor( Math.random() * 1000 );
}

test.serial('Integration: Client can authenticate and make signed requests', async ( t ) => {
	localStorageMock.clear();

	// Setup server con helper
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

	// Avvia server su porta random
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

		// Configura sessione nel client
		client.setSession( {
			sessionId: loginData.sessionId,
			token: loginData.token,
			sequenceNumber: loginData.sequenceNumber
		} );

		// Test ping con signed request
		const pingResponse = await client.signedRequestJson<{ pong: boolean }>( '/api/ping', {} );
		t.true( pingResponse.pong );

		// Test protected endpoint
		const protectedResponse = await client.signedRequestJson<{
			message: string;
			userId: number;
		}>( '/api/protected', {} );

		t.is( protectedResponse.message, 'Success' );
		t.is( protectedResponse.userId, 1 );

		// Verifica che la sequenza sia incrementata
		t.is( localStorageMock.getItem( 'sequenceNumber' ), '3' );
	} finally {
		// Chiudi server
		server.close();
	}
} );

test.serial('Integration: Client handles multiple sequential requests correctly', async ( t ) => {
	localStorageMock.clear();

	// Setup server con helper
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

		// Fai 5 richieste sequenziali
		for( let i = 0; i < 5; i++ ) {
			const response = await client.signedRequestJson<{ count: number }>(
				'/api/counter',
				{}
			);
			// Il server vede sequenceNumber dopo l'incremento
			t.is( response.count, i + 2 );
		}

		// Verifica che sequenceNumber sia stato incrementato correttamente
		t.is( localStorageMock.getItem( 'sequenceNumber' ), '6' );
	} finally {
		server.close();
	}
} );

test.serial('Integration: Client clears session on 401 response', async ( t ) => {
	localStorageMock.clear();

	// Setup server con helper
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

		// Prima richiesta: OK
		const response1 = await client.signedRequestJson<{ ok: boolean }>(
			'/api/test',
			{}
		);
		t.true( response1.ok );
		t.true( client.getSession() );

		// Elimina la sessione sul server
		await storage.delete( loginData.sessionId );

		// Seconda richiesta: dovrebbe ricevere 401 e clearSession
		const response2 = await client.signedRequest( '/api/test', {} );
		t.is( response2.status, 401 );

		// Verifica che la sessione sia stata cancellata
		t.false( client.getSession() );
		t.is( localStorageMock.getItem( 'sessionId' ), null );
	} finally {
		server.close();
	}
} );

test.serial('Integration: Server rejects requests with wrong signature', async ( t ) => {
	localStorageMock.clear();

	// Setup server con helper
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

		// Configura sessione con token sbagliato
		const wrongToken = base64urlEncode( new Uint8Array( 32 ) );
		client.setSession( {
			sessionId: loginData.sessionId,
			token: wrongToken,
			sequenceNumber: loginData.sequenceNumber
		} );

		// La richiesta dovrebbe fallire perché la firma è sbagliata
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

	// Setup server con validità firma molto breve
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

		// Crea una firma manualmente con timestamp vecchio
		const oldTimestamp = Date.now() - 200; // 200ms fa
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

		// Fai richiesta con firma scaduta
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
