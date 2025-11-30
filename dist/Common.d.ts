export type Undefinedable<T> = T | undefined;
export declare function fromBase64Url(b64url: string): Uint8Array<ArrayBuffer>;
export declare function randomBytes(bytes: number): Uint8Array<ArrayBuffer>;
export declare function randomInt(min: number, max: number): number;
export declare function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean;
export declare function hmacSha256(keyBytes: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>>;
