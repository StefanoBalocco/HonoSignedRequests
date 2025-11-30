export function fromBase64Url(b64url) {
    const pad = (4 - (b64url.length % 4)) % 4;
    const b64 = (b64url + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const cFL = binary.length;
    const returnValue = new Uint8Array(cFL);
    for (let iFL = 0; iFL < cFL; iFL++) {
        returnValue[iFL] = binary.charCodeAt(iFL);
    }
    return returnValue;
}
export function randomBytes(bytes) {
    const returnValue = new Uint8Array(bytes);
    crypto.getRandomValues(returnValue);
    return returnValue;
}
export function randomInt(min, max) {
    let returnValue;
    const range = max - min;
    if (range > 0) {
        const randomBuffer = new Uint32Array(randomBytes(4).buffer);
        returnValue = min + (randomBuffer[0] % range);
    }
    else {
        throw new Error('max must be > min');
    }
    return returnValue;
}
export function constantTimeEqual(a, b) {
    let returnValue = false;
    if (a.length === b.length) {
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
            diff |= a[i] ^ b[i];
        }
        returnValue = (diff === 0);
    }
    return returnValue;
}
export async function hmacSha256(keyBytes, data) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const textEncoder = new TextEncoder();
    const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
    return new Uint8Array(signature);
}
