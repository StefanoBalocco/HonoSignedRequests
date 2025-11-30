function _base64url_encode(value) {
    let returnValue = '';
    if (0 < value?.length) {
        try {
            const base64String = Array.from(value, (byte) => String.fromCharCode(byte)).join('');
            returnValue = btoa(base64String)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }
        catch (error) {
            console.error(`base64url_encode: failed to encode (${error})`);
        }
    }
    else {
        console.warn('base64url_encode: empty value');
    }
    return returnValue;
}
function _base64url_decode(value) {
    let returnValue;
    if (0 < value?.length && /^[A-Za-z0-9_-]*$/.test(value)) {
        const padding = value.length % 4;
        const paddedValue = 0 === padding ? value : value.padEnd(value.length + (4 - padding), '=');
        const base64 = paddedValue.replace(/-/g, '+').replace(/_/g, '/');
        try {
            const binaryString = atob(base64);
            returnValue = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
        }
        catch (error) {
            console.error(`base64url_decode: failed to decode (${error})`);
        }
    }
    else {
        console.warn('base64url_decode: empty or invalid characters');
    }
    return returnValue;
}
class SignedRequester {
    _semaphoreAcquire(wait = true) {
        let returnValue = Promise.resolve(false);
        if (!this._semaphore) {
            this._semaphore = true;
            returnValue = Promise.resolve(true);
        }
        else if (wait) {
            returnValue = new Promise((resolve) => {
                this._semaphoreQueue.push(resolve);
            });
        }
        return returnValue;
    }
    _semaphoreRelease() {
        if (this._semaphore) {
            if (0 < this._semaphoreQueue.length) {
                const nextWaiting = this._semaphoreQueue.shift();
                if (nextWaiting) {
                    nextWaiting(true);
                }
            }
            else {
                this._semaphore = false;
            }
        }
    }
    _incrementSequenceNumber() {
        if (undefined !== this._sequenceNumber) {
            this._sequenceNumber++;
            localStorage.setItem('sequenceNumber', this._sequenceNumber.toString());
        }
    }
    _loadFromStorage() {
        let returnValue = false;
        const sessionIdStr = localStorage.getItem('sessionId');
        const tokenStr = localStorage.getItem('token');
        const sequenceNumberStr = localStorage.getItem('sequenceNumber');
        if (sessionIdStr && tokenStr && sequenceNumberStr) {
            const sessionId = parseInt(sessionIdStr);
            const sequenceNumber = parseInt(sequenceNumberStr);
            const token = _base64url_decode(tokenStr);
            if (!isNaN(sessionId) && !isNaN(sequenceNumber) && token) {
                this._sessionId = sessionId;
                this._token = token;
                this._sequenceNumber = sequenceNumber;
                returnValue = true;
            }
        }
        return returnValue;
    }
    constructor(baseUrl) {
        this._semaphore = false;
        this._semaphoreQueue = [];
        this._baseUrl = baseUrl;
    }
    setSession(config) {
        const token = _base64url_decode(config.token);
        if (token) {
            this._sessionId = config.sessionId;
            this._token = token;
            this._sequenceNumber = config.sequenceNumber;
            localStorage.setItem('sessionId', config.sessionId.toString());
            localStorage.setItem('token', config.token);
            localStorage.setItem('sequenceNumber', config.sequenceNumber.toString());
        }
        else {
            throw new Error('Invalid token format');
        }
    }
    getSession() {
        let returnValue;
        if (undefined !== this._sessionId &&
            undefined !== this._token &&
            undefined !== this._sequenceNumber) {
            returnValue = true;
        }
        else {
            returnValue = this._loadFromStorage();
        }
        return returnValue;
    }
    clearSession() {
        localStorage.removeItem('sessionId');
        localStorage.removeItem('token');
        localStorage.removeItem('sequenceNumber');
        this._sessionId = undefined;
        this._token = undefined;
        this._sequenceNumber = undefined;
    }
    async signedRequest(path, parameters, options = {}) {
        let returnValue;
        let error;
        await this._semaphoreAcquire();
        try {
            if (undefined !== this._sessionId &&
                undefined !== this._token &&
                undefined !== this._sequenceNumber) {
                const timestamp = Date.now();
                const parametersArray = Object.entries(parameters);
                const parametersOrdered = [
                    ['sessionId', this._sessionId],
                    ['sequenceNumber', this._sequenceNumber],
                    ['timestamp', timestamp],
                    ...parametersArray.sort((a, b) => a[0].localeCompare(b[0]))
                ];
                const dataToSign = parametersOrdered
                    .map(([name, value]) => {
                    const serializedValue = SignedRequester._primitives.has(typeof value) || null === value
                        ? String(value)
                        : JSON.stringify(value);
                    return `${name}=${serializedValue}`;
                })
                    .join(';');
                const cryptoKey = await crypto.subtle.importKey('raw', this._token, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                const encoder = new TextEncoder();
                const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(dataToSign));
                const signature = _base64url_encode(new Uint8Array(signatureBuffer));
                const signedPayload = {
                    sessionId: this._sessionId,
                    timestamp: timestamp,
                    signature: signature
                };
                Object.assign(signedPayload, Object.fromEntries(parametersArray));
                const url = options.baseUrl
                    ? `${options.baseUrl}${path}`
                    : (this._baseUrl ? `${this._baseUrl}${path}` : path);
                const method = options.method || 'POST';
                returnValue = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    body: JSON.stringify(signedPayload)
                });
                if (returnValue.ok) {
                    this._incrementSequenceNumber();
                }
                else if (403 === returnValue.status) {
                    this.clearSession();
                }
            }
            else {
                error = new Error('Session not configured');
            }
        }
        catch (e) {
            error = e instanceof Error ? e : new Error(String(e));
        }
        finally {
            this._semaphoreRelease();
        }
        if (error) {
            throw error;
        }
        return returnValue;
    }
    async signedRequestJson(path, parameters, options = {}) {
        let returnValue;
        let error;
        try {
            const response = await this.signedRequest(path, parameters, options);
            if (response.ok) {
                returnValue = (await response.json());
            }
            else {
                error = new Error(`Request failed with status ${response.status}`);
            }
        }
        catch (e) {
            error = e instanceof Error ? e : new Error(String(e));
        }
        if (error) {
            throw error;
        }
        return returnValue;
    }
}
SignedRequester._primitives = new Set([
    'undefined',
    'string',
    'number'
]);
export const sessionManager = new SignedRequester();
export { SignedRequester };
