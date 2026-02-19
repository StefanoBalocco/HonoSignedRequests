export type Undefinedable<T> = T | undefined;

export function fromBase64Url( b64url: string ): Uint8Array<ArrayBuffer> {
	const pad: number = ( 4 - ( b64url?.length % 4 ) ) % 4;
	const b64: string = ( b64url + "=".repeat( pad ) ).replace( /-/g, "+" ).replace( /_/g, "/" );
	const binary: string = atob( b64 );
	const cFL: number = binary.length;
	const returnValue: Uint8Array<ArrayBuffer> = new Uint8Array( cFL );
	for( let iFL: number = 0; iFL < cFL; iFL++ ) {
		returnValue[ iFL ] = binary.charCodeAt( iFL );
	}
	return returnValue;
}

export function randomBytes( bytes: number ): Uint8Array<ArrayBuffer> {
	const returnValue: Uint8Array<ArrayBuffer> = new Uint8Array( bytes );
	crypto.getRandomValues( returnValue );
	return returnValue;
}

export function randomInt( min: number, max: number ): number {
	let returnValue: number;
	const range: number = max - min;
	if( range > 0 ) {
		const randomBuffer: Uint32Array<ArrayBuffer> = new Uint32Array<ArrayBuffer>( randomBytes( 4 ).buffer );
		returnValue = min + ( randomBuffer[ 0 ] % range );
	} else {
		throw new Error( 'max must be > min' );
	}
	return returnValue;
}

export function constantTimeEqual( a: Uint8Array, b: Uint8Array ): boolean {
	let returnValue = false;
	if( a.length === b.length ) {
		let diff = 0;
		for( let i = 0; i < a.length; i++ ) {
			diff |= a[ i ] ^ b[ i ];
		}
		returnValue = ( diff === 0 );
	}
	return returnValue;
}

export async function hmacSha256( keyBytes: Uint8Array<ArrayBuffer>, data: string ): Promise<Uint8Array<ArrayBuffer>> {
	const key: CryptoKey = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[ "sign" ]
	);
	const textEncoder = new TextEncoder();
	const signature: ArrayBuffer = await crypto.subtle.sign( "HMAC", key, textEncoder.encode( data ) );
	return new Uint8Array( signature );
}

export const base64Verify = /^(?=.)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const base64UrlVerify = /^(?=.)(?:[A-Za-z0-9\-_]{4})*(?:[A-Za-z0-9\-_]{2}(?:==)?|[A-Za-z0-9\-_]{3}=?)?$/;