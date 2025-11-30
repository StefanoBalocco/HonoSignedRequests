/**
 * Client-side session management library with HMAC-SHA256 signed requests
 * @module session-client
 */

type Undefinedable<T> = T | undefined;
type Nullable<T> = T | null;
type Methods = 'GET' | 'POST' | 'PUT' | 'DELETE';

type SessionConfig = {
	sessionId: number;
	token: string; // Base64URL encoded
	sequenceNumber: number;
};

type SignedRequest<T = Record<string, any>> = {
	sessionId: number;
	timestamp: number;
	signature: string;
} & T;

type SignedRequestOptions = {
	baseUrl?: string;
	headers?: Record<string, string>;
	method?: Methods;
};

// ============================================================================
// Base64URL utilities
// ============================================================================

function _base64url_encode( value: Uint8Array ): string {
	let returnValue: string = '';
	if( 0 < value?.length ) {
		try {
			const base64String = Array.from( value, ( byte ) => String.fromCharCode( byte ) ).join( '' );
			returnValue = btoa( base64String )
				.replace( /\+/g, '-' )
				.replace( /\//g, '_' )
				.replace( /=+$/, '' );
		} catch( error ) {
			console.error( `base64url_encode: failed to encode (${ error })` );
		}
	} else {
		console.warn( 'base64url_encode: empty value' );
	}
	return returnValue;
}

function _base64url_decode( value: string ): Undefinedable<Uint8Array<ArrayBuffer>> {
	let returnValue: Undefinedable<Uint8Array<ArrayBuffer>>;
	if( 0 < value?.length && /^[A-Za-z0-9_-]*$/.test( value ) ) {
		const padding = value.length % 4;
		const paddedValue =
			0 === padding ? value : value.padEnd( value.length + ( 4 - padding ), '=' );

		const base64 = paddedValue.replace( /-/g, '+' ).replace( /_/g, '/' );

		try {
			const binaryString: string = atob( base64 );
			returnValue = Uint8Array.from( binaryString, ( char ) =>
				char.charCodeAt( 0 )
			);
		} catch( error ) {
			console.error( `base64url_decode: failed to decode (${ error })` );
		}
	} else {
		console.warn( 'base64url_decode: empty or invalid characters' );
	}
	return returnValue;
}

// ============================================================================
// Session Management
// ============================================================================

class SignedRequester {
	private static readonly _primitives: Set<string> = new Set( [
		'undefined',
		'string',
		'number'
	] );

	private readonly _baseUrl: Undefinedable<string>;
	private _sessionId: Undefinedable<number>;
	private _token: Undefinedable<Uint8Array<ArrayBuffer>>;
	private _sequenceNumber: Undefinedable<number>;
	private _semaphore: boolean = false;
	private _semaphoreQueue: ( ( value: boolean | PromiseLike<boolean> ) => void )[] = [];

	/**
	 * Acquire semaphore to ensure request ordering
	 */
	private _semaphoreAcquire( wait: boolean = true ): Promise<boolean> {
		let returnValue: Promise<boolean> = Promise.resolve( false );
		if( !this._semaphore ) {
			this._semaphore = true;
			returnValue = Promise.resolve( true );
		} else if( wait ) {
			returnValue = new Promise<boolean>( ( resolve ): void => {
				this._semaphoreQueue.push( resolve );
			} );
		}
		return returnValue;
	}

	/**
	 * Release semaphore and process queue
	 */
	private _semaphoreRelease(): void {
		if( this._semaphore ) {
			if( 0 < this._semaphoreQueue.length ) {
				const nextWaiting = this._semaphoreQueue.shift();
				if( nextWaiting ) {
					nextWaiting( true );
				}
			} else {
				this._semaphore = false;
			}
		}
	}

	/**
	 * Increment and persist sequence number
	 */
	private _incrementSequenceNumber(): void {
		if( undefined !== this._sequenceNumber ) {
			this._sequenceNumber++;
			localStorage.setItem( 'sequenceNumber', this._sequenceNumber.toString() );
		}
	}

	/**
	 * Load session from localStorage into cache
	 */
	private _loadFromStorage(): boolean {
		let returnValue: boolean = false;
		const sessionIdStr: Nullable<string> = localStorage.getItem( 'sessionId' );
		const tokenStr: Nullable<string> = localStorage.getItem( 'token' );
		const sequenceNumberStr: Nullable<string> = localStorage.getItem( 'sequenceNumber' );

		if( sessionIdStr && tokenStr && sequenceNumberStr ) {
			const sessionId: number = parseInt( sessionIdStr );
			const sequenceNumber: number = parseInt( sequenceNumberStr );
			const token: Undefinedable<Uint8Array<ArrayBuffer>> = _base64url_decode( tokenStr );

			if( !isNaN( sessionId ) && !isNaN( sequenceNumber ) && token ) {
				this._sessionId = sessionId;
				this._token = token;
				this._sequenceNumber = sequenceNumber;
				returnValue = true;
			}
		}
		return returnValue;
	}

	/**
	 * Initialize the session manager with optional base URL
	 * If baseUrl is not provided, fetch will use relative paths (current host)
	 */
	constructor( baseUrl?: string ) {
		this._baseUrl = baseUrl;
	}

	/**
	 * Set session configuration (call after login)
	 */
	public setSession( config: SessionConfig ): void {
		const token: Undefinedable<Uint8Array<ArrayBuffer>> = _base64url_decode( config.token );
		if( token ) {
			this._sessionId = config.sessionId;
			this._token = token;
			this._sequenceNumber = config.sequenceNumber;

			// Persist to localStorage
			localStorage.setItem( 'sessionId', config.sessionId.toString() );
			localStorage.setItem( 'token', config.token );
			localStorage.setItem( 'sequenceNumber', config.sequenceNumber.toString() );
		} else {
			throw new Error( 'Invalid token format' );
		}
	}

	/**
	 * Check if the session exists and load it from localStorage if needed
	 * Call this once at page load
	 */
	public getSession(): boolean {
		let returnValue: boolean;

		// Check cache first
		if(
			undefined !== this._sessionId &&
			undefined !== this._token &&
			undefined !== this._sequenceNumber
		) {
			returnValue = true;
		} else {
			// Try loading from localStorage
			returnValue = this._loadFromStorage();
		}

		return returnValue;
	}

	/**
	 * Clear session (logout)
	 */
	public clearSession(): void {
		localStorage.removeItem( 'sessionId' );
		localStorage.removeItem( 'token' );
		localStorage.removeItem( 'sequenceNumber' );
		this._sessionId = undefined;
		this._token = undefined;
		this._sequenceNumber = undefined;
	}

	/**
	 * Make a signed request to the server
	 */
	public async signedRequest(
		path: string,
		parameters: Record<string, any>,
		options: SignedRequestOptions = {}
	): Promise<Response> {
		let returnValue: Undefinedable<Response>;
		let error: Undefinedable<Error>;

		// Acquire semaphore to ensure request ordering
		await this._semaphoreAcquire();

		try {
			// Check if the session is configured
			if(
				undefined !== this._sessionId &&
				undefined !== this._token &&
				undefined !== this._sequenceNumber
			) {
				// Generate signature
				const timestamp: number = Date.now();
				const parametersArray: [ string, any ][] = Object.entries( parameters );

				const parametersOrdered: [ string, any ][] = [
					[ 'sessionId', this._sessionId ],
					[ 'sequenceNumber', this._sequenceNumber ],
					[ 'timestamp', timestamp ],
					...parametersArray.sort( ( a: [ string, any ], b: [ string, any ] ): number =>
						a[ 0 ].localeCompare( b[ 0 ] )
					)
				];

				const dataToSign = parametersOrdered
					.map( ( [ name, value ]: [ string, any ] ): string => {
						const serializedValue: string =
							SignedRequester._primitives.has( typeof value ) || null === value
								? String( value )
								: JSON.stringify( value );
						return `${ name }=${ serializedValue }`;
					} )
					.join( ';' );

				const cryptoKey: CryptoKey = await crypto.subtle.importKey(
					'raw',
					this._token,
					{ name: 'HMAC', hash: 'SHA-256' },
					false,
					[ 'sign' ]
				);

				const encoder: TextEncoder = new TextEncoder();
				const signatureBuffer: ArrayBuffer = await crypto.subtle.sign(
					'HMAC',
					cryptoKey,
					encoder.encode( dataToSign )
				);

				const signature: string = _base64url_encode( new Uint8Array( signatureBuffer ) );

				// Build signed request
				const signedPayload: SignedRequest = {
					sessionId: this._sessionId,
					timestamp: timestamp,
					signature: signature
				};
				Object.assign( signedPayload, Object.fromEntries( parametersArray ) );

				// Build URL: options.baseUrl has priority, then instance baseUrl, then relative path
				const url: string = options.baseUrl
					? `${ options.baseUrl }${ path }`
					: ( this._baseUrl ? `${ this._baseUrl }${ path }` : path );
				const method: Methods = options.method || 'POST';

				returnValue = await fetch( url, {
					method: method,
					headers: {
						'Content-Type': 'application/json',
						...options.headers
					},
					body: JSON.stringify( signedPayload )
				} );

				// Increment sequence number on successful request
				if( returnValue.ok ) {
					this._incrementSequenceNumber();
				} else if( 403 === returnValue.status ) {
					// Session non valida, cancella tutto
					this.clearSession();
				}
			} else {
				error = new Error( 'Session not configured' );
			}
		} catch( e ) {
			error = e instanceof Error ? e : new Error( String( e ) );
		} finally {
			// Always release semaphore
			this._semaphoreRelease();
		}

		// Throw error after semaphore release
		if( error ) {
			throw error;
		}

		return returnValue!;
	}

	/**
	 * Make a signed request and parse JSON response
	 */
	public async signedRequestJson<T = any>(
		path: string,
		parameters: Record<string, any>,
		options: SignedRequestOptions = {}
	): Promise<T> {
		let returnValue: Undefinedable<T>;
		let error: Undefinedable<Error>;

		try {
			const response: Response = await this.signedRequest( path, parameters, options );
			if( response.ok ) {
				returnValue = ( await response.json() ) as T;
			} else {
				error = new Error( `Request failed with status ${ response.status }` );
			}
		} catch( e ) {
			error = e instanceof Error ? e : new Error( String( e ) );
		}

		if( error ) {
			throw error;
		}

		return returnValue!;
	}
}

// ============================================================================
// Exports
// ============================================================================

// Export singleton instance (without baseUrl, uses relative paths)
export const sessionManager = new SignedRequester();

// Export types
export type { SessionConfig, SignedRequest, SignedRequestOptions };

// Export class for custom instances
export { SignedRequester };