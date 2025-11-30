# @stefanobalocco/honosignedrequests

A Hono middleware for HMAC-SHA256 signed requests with replay attack protection via sequence numbers.

## Overview

This library provides server-side session management and request signature validation for Hono applications, along with a browser client for making signed requests.

### Authentication Mechanism

Each session is associated with a cryptographic **token** (a random byte array) shared between client and server. Every request is authenticated by computing an HMAC-SHA256 signature using this token as the secret key. The signature is computed over:

- Session ID
- Sequence number (monotonically increasing to prevent replay attacks)
- Timestamp (to limit signature validity window)
- Request parameters (sorted alphabetically)

The server validates the signature using the same token, verifies the timestamp falls within the allowed window, and checks that the sequence number is the expected next value for that session.

## Features

- HMAC-SHA256 request signing with shared secret token
- Replay attack protection via monotonic sequence numbers
- Timestamp validation with configurable tolerance
- Constant-time signature comparison
- Pluggable session storage architecture
- Works with Node.js, Cloudflare Workers, Deno, and Bun

## Installation

```bash
npm install @stefanobalocco/honosignedrequests
```

## Server-Side Usage

### Basic Setup

```typescript
import { Hono } from 'hono';
import { SignedRequestsManager, SessionsStorageLocal } from '@stefanobalocco/honosignedrequests';

const app = new Hono();

// SessionsStorageLocal is a simple in-memory storage implementation
// You can implement your own SessionsStorage (e.g., Redis-based) for production
const storage = new SessionsStorageLocal({
  maxSessions: 65535,         // Storage-specific: maximum concurrent sessions in memory
  maxSessionsPerUser: 3       // Storage-specific: maximum sessions per user
});

// Generic parameters are passed to SignedRequestsManager
const signedRequests = new SignedRequestsManager(storage, {
  validitySignature: 5000,      // signature valid for 5 seconds
  validityToken: 3600000,       // session valid for 1 hour
  tokenLength: 32               // token size in bytes
});

app.use('/api/*', signedRequests.middleware);
```

### Session Creation (Login Endpoint)

```typescript
app.post('/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  
  // Your authentication logic here
  const userId = await authenticateUser(username, password);
  
  if (!userId) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  // Use the manager's createSession method
  const session = await signedRequests.createSession(userId);
  
  // Convert token to Base64URL for transmission to client
  const tokenBase64 = btoa(String.fromCharCode(...session.token))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  
  return c.json({
    sessionId: session.id,
    token: tokenBase64,
    sequenceNumber: session.sequenceNumber
  });
});
```

### Ping Endpoint (Verify Authentication)

```typescript
app.post('/api/ping', (c) => {
  const session = c.get('session');
  return c.json({ pong: !!session });
});
```

### Protected Endpoint

```typescript
app.post('/api/protected', (c) => {
  const session = c.get('session');
  
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  return c.json({
    message: 'Authenticated',
    userId: session.userId
  });
});
```

### Configuration

The library separates **generic parameters** (common to all storage implementations) from **storage-specific parameters**.

#### Generic Parameters (SignedRequestsManagerConfig)

These are passed to `SignedRequestsManager` constructor and apply to all storage implementations:

| Option | Default | Description |
|--------|---------|-------------|
| `validitySignature` | 5000 | Signature validity window in milliseconds |
| `validityToken` | 3600000 | Session token validity in milliseconds |
| `tokenLength` | 32 | Token length in bytes (cryptographic secret) |

#### SessionsStorageLocal Specific Parameters

These are specific to the in-memory implementation:

| Option | Default | Description |
|--------|---------|-------------|
| `maxSessions` | 65535 | Maximum concurrent sessions in memory |
| `maxSessionsPerUser` | 3 | Maximum sessions per user (enforced by removing oldest) |

## Client-Side Usage

### Browser Import (CDN)

```html
<script type="module">
  import { SignedRequester } from 'https://cdn.jsdelivr.net/gh/StefanoBalocco/HonoSignedRequests/client/dist/SignedRequester.min.js';
  
  const requester = new SignedRequester();
  // You can also specify a base URL for request
  //const requester = new SignedRequester('https://api.example.com');
  
  // Check if we have session data stored
  let needLogin = true;
  if (requester.getSession()) {
    // Try to verify the session is still valid
    try {
      const response = await requester.signedRequestJson('/api/ping', {});
      
      if (response?.pong) {
        needLogin = false;
      }
    } catch (error) {
    }
  }
  
  if( needLogin ) {
    // No session data, need to login
		const response = await fetch('/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'user@example.com',
				password: 'password123'
			})
		});

		const loginData = await response.json();

		// Store session credentials
		requester.setSession({
			sessionId: loginData.sessionId,
			token: loginData.token,
			sequenceNumber: loginData.sequenceNumber
		});
  }
  
  // Now we're authenticated, make protected requests
  const data = await requester.signedRequestJson('/api/protected', {
    action: 'getData'
  });
</script>
```

### Client API

#### `setSession(config)`

Initialize session after login.

```javascript
requester.setSession({
  sessionId: 12345,
  token: 'base64url_encoded_token',
  sequenceNumber: 1
});
```

#### `getSession()`

Check if a valid session exists. Loads from localStorage if not in memory.

```javascript
if (requester.getSession()) {
  // Session available
}
```

#### `signedRequest(path, parameters, options?)`

Make a signed request, returns the raw Response object.

```javascript
const response = await requester.signedRequest('/api/action', {
  param1: 'value1',
  param2: 123
});
```

#### `signedRequestJson<T>(path, parameters, options?)`

Make a signed request and parse JSON response.

```javascript
const data = await requester.signedRequestJson('/api/data', {
  query: 'example'
});
```

#### `clearSession()`

Clear session data (for example after you do a logout).

```javascript
requester.clearSession();
```

### Request Options

```typescript
{
  baseUrl?: string;           // Override base URL for this request
  headers?: Record<string, string>;  // Additional headers
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';  // HTTP method (default: POST)
}
```

## Signature Format

The signature is computed over the following concatenated string:

```
sessionId={id};sequenceNumber={seq};timestamp={ts};{sorted_params}
```

The HMAC-SHA256 signature is computed using the session token as the secret key.

Parameters are sorted alphabetically by key. Values are serialized as:
- Primitives (string, number, boolean) and null: `String(value)`
- Objects and arrays: `JSON.stringify(value)`

## Implementing Custom Storage

To implement your own session storage (e.g., Redis-based), extend the `SessionsStorage` abstract class:

```typescript
import { SessionsStorage } from '@stefanobalocco/honosignedrequests';
import { Session } from '@stefanobalocco/honosignedrequests';

class RedisSessionsStorage extends SessionsStorage {
  async validate(
    validitySignature: number,
    validityToken: number,
    sessionId: number,
    timestamp: number,
    parameters: [string, any][],
    signature: Uint8Array<ArrayBuffer>
  ): Promise<Session | undefined> {
    // Implement validation logic with Redis
    // Use validitySignature to check timestamp window
    // Use validityToken to verify session hasn't expired
  }

  async create(
    validityToken: number,
    tokenLength: number,
    userId: number
  ): Promise<Session> {
    // Implement session creation with Redis
    // Generate token with specified tokenLength
    // Use validityToken for Redis TTL or expiration tracking
    // Implement your own maxSessionsPerUser logic if needed
  }
}
```

The generic parameters (`validitySignature`, `validityToken`, `tokenLength`) are passed by `SignedRequestsManager` to your storage implementation. Storage-specific behaviors like `maxSessionsPerUser` limits should be implemented according to your storage's characteristics (e.g., Redis TTL, database triggers, etc.).

## Security Considerations

- The session **token** is the cryptographic secret used for HMAC signature computation
- The token is randomly generated during session creation and shared only once with the client
- The sequence number increments with each successful request, preventing replay attacks
- Timestamps are validated within a configurable window to prevent delayed replay
- Signatures use constant-time comparison to prevent timing attacks
- Sessions automatically expire and are cleaned up
- Invalid sessions return 403 and trigger client-side session clearing

## License

BSD-3-Clause
