import test from 'ava';
import { SessionsStorageLocal } from '../../dist/SessionsStorageLocal.js';

test('SessionsStorageLocal creates session with default config', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const session = await storage.create( 3600000, 32, 1 );
	
	t.is( typeof session.id, 'number' );
	t.is( session.userId, 1 );
	t.is( session.sequenceNumber, 1 );
	t.true( session.token instanceof Uint8Array );
	t.is( session.token.length, 32 );
	t.is( typeof session.lastUsed, 'number' );
	t.deepEqual( session.data, [] );
} );

test('SessionsStorageLocal creates session with custom config', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessions: 100,
		maxSessionsPerUser: 5
	} );
	
	const session = await storage.create( 3600000, 64, 1 );
	
	t.is( session.token.length, 64 );
} );

test('SessionsStorageLocal assigns unique session IDs', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const sessions = await Promise.all( [
		storage.create( 3600000, 32, 1 ),
		storage.create( 3600000, 32, 1 ),
		storage.create( 3600000, 32, 1 )
	] );
	
	const ids = sessions.map( s => s.id );
	const uniqueIds = new Set( ids );
	
	t.is( uniqueIds.size, 3 );
} );

test('SessionsStorageLocal enforces maxSessionsPerUser', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessionsPerUser: 2
	} );
	
	const session1 = await storage.create( 3600000, 32, 1 );
	const session2 = await storage.create( 3600000, 32, 1 );
	const session3 = await storage.create( 3600000, 32, 1 );
	
	const userSessions = await storage.getByUserId( 1 );
	
	t.is( userSessions.length, 2 );
	t.false( userSessions.some( s => s.id === session1.id ) ); // First session removed
	t.true( userSessions.some( s => s.id === session2.id ) );
	t.true( userSessions.some( s => s.id === session3.id ) );
} );

test('SessionsStorageLocal getBySessionId returns session', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const created = await storage.create( 3600000, 32, 1 );
	
	const retrieved = await storage.getBySessionId( created.id );
	
	t.truthy( retrieved );
	t.is( retrieved!.id, created.id );
	t.is( retrieved!.userId, 1 );
} );

test('SessionsStorageLocal getBySessionId returns undefined for non-existent', async ( t ) => {
	const storage = new SessionsStorageLocal();
	
	const retrieved = await storage.getBySessionId( 99999 );
	
	t.is( retrieved, undefined );
} );

test('SessionsStorageLocal getByUserId returns all user sessions', async ( t ) => {
	const storage = new SessionsStorageLocal();
	
	await storage.create( 3600000, 32, 1 );
	await storage.create( 3600000, 32, 1 );
	await storage.create( 3600000, 32, 2 ); // Different user
	
	const user1Sessions = await storage.getByUserId( 1 );
	const user2Sessions = await storage.getByUserId( 2 );
	
	t.is( user1Sessions.length, 2 );
	t.is( user2Sessions.length, 1 );
} );

test('SessionsStorageLocal delete removes session', async ( t ) => {
	const storage = new SessionsStorageLocal();
	const session = await storage.create( 3600000, 32, 1 );
	
	const deleted = await storage.delete( session.id );
	
	t.true( deleted );
	
	const retrieved = await storage.getBySessionId( session.id );
	t.is( retrieved, undefined );
} );

test('SessionsStorageLocal delete returns false for non-existent', async ( t ) => {
	const storage = new SessionsStorageLocal();
	
	const deleted = await storage.delete( 99999 );
	
	t.false( deleted );
} );

test('SessionsStorageLocal cleans up expired sessions', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessions: 10
	} );

	// Create 8 sessions (exceeds the 75% cleanup threshold)
	const sessions = [];
	for( let i = 0; i < 8; i++ ) {
		sessions.push( await storage.create( 100, 32, i ) ); // Very low validityToken
	}

	// Wait for them to expire
	await new Promise( resolve => setTimeout( resolve, 150 ) );

	// Create a new session with the SAME validityToken to trigger cleanup correctly
	// (cleanup uses the validityToken passed to the current create call)
	const newSession = await storage.create( 100, 32, 99 );

	// Expired sessions should have been removed
	// (exclude the new session's ID which may have reused an expired ID)
	for( const session of sessions ) {
		if( session.id === newSession.id ) {
			// The new session reused this ID, verify it's the new session
			const retrieved = await storage.getBySessionId( session.id );
			t.is( retrieved?.userId, 99 );
		} else {
			const retrieved = await storage.getBySessionId( session.id );
			t.is( retrieved, undefined );
		}
	}
} );

test('SessionsStorageLocal throws when session array is full', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessions: 3
	} );
	
	await storage.create( 3600000, 32, 1 );
	await storage.create( 3600000, 32, 2 );
	await storage.create( 3600000, 32, 3 );
	
	await t.throwsAsync(
		async () => storage.create( 3600000, 32, 4 ),
		{ message: 'Session array full' }
	);
} );

test('SessionsStorageLocal allows reuse of expired session IDs', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessions: 1 // Con solo 1 slot, l'ID sarà sempre 0
	} );

	const session1 = await storage.create( 100, 32, 1 ); // Very low validityToken
	t.is( session1.id, 0 );

	// Wait for it to expire
	await new Promise( resolve => setTimeout( resolve, 150 ) );

	// Must use the SAME validityToken to consider the session expired
	// (ID selection logic uses the validityToken passed to the current call)
	const session2 = await storage.create( 100, 32, 2 );
	t.is( session2.id, 0 );
} );

test('SessionsStorageLocal allows creating session after expiration without error', async ( t ) => {
	const storage = new SessionsStorageLocal( {
		maxSessions: 3
	} );

	// Fill all slots
	await storage.create( 100, 32, 1 );
	await storage.create( 100, 32, 2 );
	await storage.create( 100, 32, 3 );

	// Wait for them to expire
	await new Promise( resolve => setTimeout( resolve, 150 ) );

	// Should be able to create a new session without error
	// because expired IDs are available again (with the same validityToken)
	await t.notThrowsAsync( async () => storage.create( 100, 32, 4 ) );
} );
