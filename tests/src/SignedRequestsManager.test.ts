import test from 'ava';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';

import { SignedRequestsManager } from '../../dist/SignedRequestsManager.js';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';
import { SignedRequester } from '../../client/dist/SignedRequester.js';

import {
	LocalStorageMock,
	base64urlEncode,
	createSignature,
	createStorageAndManager,
	createMiddlewareApp,
	createAuthenticatedApp,
	getAvailablePort
} from './TestHelpers.js';

// Setup global localStorage mock
const localStorageMock = new LocalStorageMock();
( global as any ).localStorage = localStorageMock;

// ============================================================================
// Unit Tests: SignedRequestsManager
// ============================================================================

test( 'SignedRequestsManager: Creates session', async ( t ) => {
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

test( 'SignedRequestsManager: Validates correct signature', async ( t ) => {
	const { manager } = createStorageAndManager();
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];

	const { signature } = await createSignature( session, timestamp, parameters );

	const validatedSession = await manager.validate(
		session.id,
		timestamp,
		parameters,
		signature
	);

	t.truthy( validatedSession );
	t.is( validatedSession!.id, session.id );
	t.is( validatedSession!.sequenceNumber, 2 ); // Incremented after validation
} );

test( 'SignedRequestsManager: Rejects invalid signature', async ( t ) => {
	const { manager } = createStorageAndManager();
	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const wrongSignature = new Uint8Array( 32 );

	const validatedSession = await manager.validate(
		session.id,
		timestamp,
		parameters,
		wrongSignature
	);

	t.is( validatedSession, undefined );
} );

test( 'SignedRequestsManager: Rejects expired timestamp', async ( t ) => {
	const { manager } = createStorageAndManager( { validitySignature: 1000 } );
	const session = await manager.createSession( 1 );
	const oldTimestamp = Date.now() - 2000; // 2 seconds ago
	const parameters: [ string, any ][] = [];

	const { signature } = await createSignature( session, oldTimestamp, parameters );

	const validatedSession = await manager.validate(
		session.id,
		oldTimestamp,
		parameters,
		signature
	);

	t.is( validatedSession, undefined );
} );

test( 'SignedRequestsManager: Rejects future timestamp', async ( t ) => {
	const { manager } = createStorageAndManager();
	const session = await manager.createSession( 1 );
	const futureTimestamp = Date.now() + 10000; // 10 seconds in the future
	const parameters: [ string, any ][] = [];

	const { signature } = await createSignature( session, futureTimestamp, parameters );

	const validatedSession = await manager.validate(
		session.id,
		futureTimestamp,
		parameters,
		signature
	);

	t.is( validatedSession, undefined );
} );

test( 'SignedRequestsManager: Deletes expired session during validation', async ( t ) => {
	const validityToken = 100; // 100ms
	const { storage, manager } = createStorageAndManager( { validityToken } );
	const session = await manager.createSession( 1 );

	// Simulate expired session by modifying lastUsed
	session.lastUsed = Date.now() - validityToken - 50;

	const timestamp = Date.now();
	const parameters: [ string, any ][] = [];
	const { signature } = await createSignature( session, timestamp, parameters );

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

test( 'SignedRequestsManager: Uses default storage if none provided', async ( t ) => {
	const manager = new SignedRequestsManager();
	const session = await manager.createSession( 1 );

	t.truthy( session );
	t.is( session.userId, 1 );
} );

// ============================================================================
// Unit Tests: Middleware - Methods reading from query string (GET, HEAD)
// ============================================================================

test( 'Middleware: Validates GET request', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.get( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'GET'
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates HEAD request', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	// Hono routes HEAD to the GET handler internally (body is stripped).
	// We set a custom header so HEAD responses can be inspected without a body.
	app.get( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		c.header( 'x-authenticated', session ? 'true' : 'false' );
		return c.body( null, 200 );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'HEAD'
	} );

	t.is( res.status, 200 );
	t.is( res.headers.get( 'x-authenticated' ), 'true' );
} );

// ============================================================================
// Unit Tests: Middleware - Methods reading from body (POST, PUT, DELETE, PATCH)
// ============================================================================

test( 'Middleware: Validates POST request with JSON', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature: signatureBase64,
			action: 'test'
		} )
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates POST request with form data', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const formData = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formData.toString()
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates PUT request with JSON', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.put( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const res = await app.request( '/api/test', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature: signatureBase64,
			action: 'test'
		} )
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates PUT request with form data', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.put( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const formData = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( '/api/test', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formData.toString()
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates DELETE request with JSON', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.delete( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const res = await app.request( '/api/test', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature: signatureBase64,
			action: 'test'
		} )
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

test( 'Middleware: Validates PATCH request with JSON', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.patch( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session, userId: session?.userId } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const res = await app.request( '/api/test', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp,
			signature: signatureBase64,
			action: 'test'
		} )
	} );

	const json = await res.json() as { authenticated: boolean; userId: number };

	t.is( res.status, 200 );
	t.true( json.authenticated );
	t.is( json.userId, 1 );
} );

// ============================================================================
// Unit Tests: Middleware - Wrong parameter location
// ============================================================================

test( 'Middleware: POST with params only in query string is not authenticated', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {} )
	} );

	const json = await res.json() as { authenticated: boolean };
	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

test( 'Middleware: PUT with params only in query string is not authenticated', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.put( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {} )
	} );

	const json = await res.json() as { authenticated: boolean };
	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

test( 'Middleware: DELETE with params only in query string is not authenticated', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.delete( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {} )
	} );

	const json = await res.json() as { authenticated: boolean };
	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

test( 'Middleware: PATCH with params only in query string is not authenticated', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.patch( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
	const { signatureBase64 } = await createSignature( session, timestamp, parameters );

	const queryParams = new URLSearchParams( {
		sessionId: String( session.id ),
		timestamp: String( timestamp ),
		signature: signatureBase64,
		action: 'test'
	} );

	const res = await app.request( `/api/test?${ queryParams.toString() }`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {} )
	} );

	const json = await res.json() as { authenticated: boolean };
	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

// ============================================================================
// Unit Tests: Middleware - Error handling
// ============================================================================

test( 'Middleware: Rejects invalid signature', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );
	const timestamp = Date.now();
	const wrongSignature = base64urlEncode( new Uint8Array( 32 ) );

	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
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

test( 'Middleware: Handles malformed signature gracefully', async ( t ) => {
	const { manager } = createStorageAndManager();
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );

	const res = await app.request( '/api/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp: Date.now(),
			signature: '!!!invalid-base64!!!'
		} )
	} );

	const json = await res.json() as { authenticated: boolean };

	t.is( res.status, 200 );
	t.false( json.authenticated );
} );

test( 'Middleware: Calls onError callback when validation fails', async ( t ) => {
	const errors: unknown[] = [];
	const { manager } = createStorageAndManager( {
		onError: ( error ) => errors.push( error )
	} );
	const app = createMiddlewareApp( manager );

	app.post( '/api/test', ( c ) => {
		const session = c.get( 'session' );
		return c.json( { authenticated: !!session } );
	} );

	const session = await manager.createSession( 1 );

	await app.request( '/api/test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			sessionId: session.id,
			timestamp: Date.now(),
			signature: '!!!invalid-base64!!!'
		} )
	} );

	t.is( errors.length, 1 );
	t.true( errors[ 0 ] instanceof Error );
} );

// ============================================================================
// Integration Tests: Server + Client
// ============================================================================

test.serial( 'Integration: Client can authenticate and make signed requests', async ( t ) => {
	localStorageMock.clear();

	const { manager } = createStorageAndManager();
	const app = createAuthenticatedApp( manager );

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

	const port = getAvailablePort();
	const server = serve( { fetch: app.fetch, port } );
	const actualPort = ( server.address() as AddressInfo ).port;
	const baseUrl = `http://localhost:${ actualPort }`;

	try {
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
		client.setSession( loginData );

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
		server.close();
	}
} );

test.serial( 'Integration: Client handles multiple sequential requests correctly', async ( t ) => {
	localStorageMock.clear();

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

test.serial( 'Integration: Client clears session on 401 response', async ( t ) => {
	localStorageMock.clear();

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

test.serial( 'Integration: Server rejects requests with wrong signature', async ( t ) => {
	localStorageMock.clear();

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

test.serial( 'Integration: Server rejects expired signatures', async ( t ) => {
	localStorageMock.clear();

	const { storage, manager } = createStorageAndManager( { validitySignature: 100 } );
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
		const parameters: [ string, any ][] = [ [ 'action', 'test' ] ];
		const { signatureBase64 } = await createSignature( session!, oldTimestamp, parameters );

		// Make request with expired signature
		const response = await fetch( `${ baseUrl }/api/test`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				sessionId: loginData.sessionId,
				timestamp: oldTimestamp,
				signature: signatureBase64,
				action: 'test'
			} )
		} );

		const json = await response.json() as { authenticated: boolean };
		t.false( json.authenticated );
	} finally {
		server.close();
	}
} );
