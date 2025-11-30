# @stefanobalocco/honosignedrequests

A Hono middleware for HMAC-SHA256 signed requests with replay attack protection via sequence numbers.

## Overview

This library provides server-side session management and request signature validation for Hono applications, along with a browser client for making signed requests. Each request is authenticated using HMAC-SHA256 signatures computed over the request parameters, timestamp, and an incrementing sequence number that prevents replay attacks.

## Features

- HMAC-SHA256 request signing
- Replay attack protection via monotonic sequence numbers
- Timestamp validation with configurable tolerance
- Constant-time signature comparison
- Session management with automatic cleanup
- Per-user session limits
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

const storage = new SessionsStorageLocal({
  maxSessions: 65535,
  maxSessionsPerUser: 3,
  validitySignature: 5000,    // signature valid for 5 seconds
  validityToken: 3600000,     // session valid for 1 hour
  tokenLength: 32
});

const signedRequests = new SignedRequestsManager(storage);

app.use('/api/*', signedRequests.middleware);
```

### Session Creation (Login Endpoint)

```typescript
import { toBase64Url } from '@stefanobalocco/honosignedrequests';

app.post('/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  
  // Your authentication logic here
  const userId = await authenticateUser(username, password);
  
  if (!userId) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  const session = await storage.create(userId);
  
  // Convert token to Base64URL for transmission
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

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxSessions` | 65535 | Maximum concurrent sessions |
| `maxSessionsPerUser` | 3 | Maximum sessions per user |
| `validitySignature` | 5000 | Signature validity window in milliseconds |
| `validityToken` | 3600000 | Session token validity in milliseconds |
| `tokenLength` | 32 | Token length in bytes |

## Client-Side Usage

### Browser Import (CDN)

```html
<script type="module">
  import { sessionManager } from 'https://cdn.example.com/honosignedrequests/dist/client/SignedRequester.js';
  
  // After login, store session credentials
  sessionManager.setSession({
    sessionId: response.sessionId,
    token: response.token,
    sequenceNumber: response.sequenceNumber
  });
  
  // Make signed requests
  const data = await sessionManager.signedRequestJson('/api/protected', {
    action: 'getData'
  });
</script>
```

### Custom Instance

```javascript
import { SessionManager } from 'https://cdn.example.com/honosignedrequests/dist/client/SignedRequester.js';

const session = new SessionManager('https://api.example.com');
```

### Client API

#### `sessionManager.setSession(config)`

Initialize session after login.

```javascript
sessionManager.setSession({
  sessionId: 12345,
  token: 'base64url_encoded_token',
  sequenceNumber: 1
});
```

#### `sessionManager.getSession()`

Check if a valid session exists. Loads from localStorage if not in memory.

```javascript
if (sessionManager.getSession()) {
  // Session available
}
```

#### `sessionManager.signedRequest(path, parameters, options?)`

Make a signed request, returns the raw Response object.

```javascript
const response = await sessionManager.signedRequest('/api/action', {
  param1: 'value1',
  param2: 123
});
```

#### `sessionManager.signedRequestJson<T>(path, parameters, options?)`

Make a signed request and parse JSON response.

```javascript
const data = await sessionManager.signedRequestJson('/api/data', {
  query: 'example'
});
```

#### `sessionManager.clearSession()`

Clear session data (logout).

```javascript
sessionManager.clearSession();
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

Parameters are sorted alphabetically by key. Values are serialized as:
- Primitives (string, number, boolean) and null: `String(value)`
- Objects and arrays: `JSON.stringify(value)`

## Security Considerations

- The sequence number increments with each successful request, preventing replay attacks
- Timestamps are validated within a configurable window to prevent delayed replay
- Signatures use constant-time comparison to prevent timing attacks
- Sessions automatically expire and are cleaned up
- Invalid sessions return 403 and trigger client-side session clearing

## License

BSD-3-Clause
