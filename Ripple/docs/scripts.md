# Ripple Script Runtime Documentation

Ripple supports Postman-compatible pre-request and test scripts with an enhanced runtime that includes `pm.sendRequest()`, cookies management, and crypto utilities.

## Table of Contents

- [Overview](#overview)
- [pm.sendRequest()](#pmsendrequest)
- [pm.cookies](#pmcookies)
- [pm.utils](#pmutils)
- [Variables & Environment](#variables--environment)
- [Testing](#testing)
- [Examples](#examples)

## Overview

Scripts in Ripple run in the browser JavaScript environment with access to a `pm` object that provides Postman-compatible APIs. Scripts support modern JavaScript features including `async/await`, promises, and ES6+ syntax.

### Script Types

1. **Pre-request Scripts**: Run before sending the request. Can modify request URL, headers, and body.
2. **Test Scripts**: Run after receiving the response. Used for assertions and extracting data from responses.

### Basic pm Object

```javascript
pm.request.url        // Get/set request URL
pm.request.method     // Get/set request method
pm.request.headers    // Manage request headers
pm.request.body       // Get/set request body

pm.response.code      // HTTP status code (test scripts only)
pm.response.status    // HTTP status text (test scripts only)
pm.response.json()    // Parse response as JSON (test scripts only)
pm.response.text()    // Get response as text (test scripts only)

pm.variables          // Environment variables
pm.globals            // Global variables
pm.collectionVariables // Collection variables
```

## pm.sendRequest()

Send HTTP requests from within your scripts. Fully async and supports all HTTP methods.

### Syntax

```javascript
const response = await pm.sendRequest(requestOptions);
```

### Request Options

```javascript
{
  url: "https://api.example.com/endpoint",     // Required
  method: "GET",                               // Optional (default: GET)
  header: {                                    // Optional headers
    "Authorization": "Bearer token",
    "Content-Type": "application/json"
  },
  // OR array format:
  header: [
    { key: "Authorization", value: "Bearer token" },
    { key: "Content-Type", value: "application/json" }
  ],
  body: {                                      // Optional request body
    mode: "raw",                              // raw, urlencoded, formdata, graphql
    raw: '{"name": "test"}',                  // For raw mode
    urlencoded: [                             // For urlencoded mode
      { key: "name", value: "test" },
      { key: "email", value: "test@example.com" }
    ],
    formdata: [                               // For formdata mode
      { key: "file", value: "content", type: "text" },
      { key: "description", value: "A file upload" }
    ],
    graphql: {                                // For GraphQL mode
      query: "query { user(id: 1) { name } }",
      variables: '{"id": 1}'
    }
  }
}
```

### Response Object

```javascript
{
  code: 200,                    // HTTP status code
  status: "OK",                 // HTTP status text
  header: { ... },              // Response headers
  body: "...",                  // Response body as string
  responseTime: 150,            // Response time in milliseconds
  json() { ... },               // Parse body as JSON
  text() { ... }                // Get body as text (same as .body)
}
```

### Examples

#### Simple GET Request

```javascript
const response = await pm.sendRequest({
  url: "https://api.github.com/users/octocat"
});

console.log("Status:", response.code);
const user = response.json();
console.log("User:", user.name);

// Set variables from response
pm.variables.set("user_id", user.id.toString());
```

#### POST with JSON Body

```javascript
const response = await pm.sendRequest({
  url: "https://api.example.com/users",
  method: "POST",
  header: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${pm.variables.get("token")}`
  },
  body: {
    mode: "raw",
    raw: JSON.stringify({
      name: "John Doe",
      email: "john@example.com"
    })
  }
});

if (response.code === 201) {
  const newUser = response.json();
  pm.variables.set("created_user_id", newUser.id);
}
```

#### Form Data Upload

```javascript
const response = await pm.sendRequest({
  url: "https://api.example.com/upload",
  method: "POST",
  body: {
    mode: "formdata",
    formdata: [
      { key: "title", value: "My Document" },
      { key: "category", value: "reports" },
      { key: "public", value: "true" }
    ]
  }
});
```

#### Chain Multiple Requests

```javascript
// First, get auth token
const authResponse = await pm.sendRequest({
  url: "https://api.example.com/auth",
  method: "POST",
  body: {
    mode: "raw",
    raw: JSON.stringify({
      username: pm.variables.get("username"),
      password: pm.variables.get("password")
    })
  }
});

const token = authResponse.json().token;

// Then, use token for protected endpoint
const dataResponse = await pm.sendRequest({
  url: "https://api.example.com/protected-data",
  header: {
    "Authorization": `Bearer ${token}`
  }
});

console.log("Protected data:", dataResponse.json());
```

## pm.cookies

Manage HTTP cookies for the current collection. Cookies are automatically included in subsequent requests to matching domains.

### API Methods

#### Get Cookie

```javascript
const value = await pm.cookies.get(name, url?);
```

- `name` (string): Cookie name to retrieve
- `url` (string, optional): URL to match against cookie domain/path
- Returns: Cookie value as string or `null` if not found

#### Set Cookie

```javascript
await pm.cookies.set(name, value, options?);
```

- `name` (string): Cookie name
- `value` (string): Cookie value
- `options` (object, optional): Cookie attributes

```javascript
{
  url: "https://example.com",        // URL to extract domain from
  domain: "example.com",             // Explicit domain (overrides url)
  path: "/api",                      // Cookie path (default: "/")
  secure: true,                      // Secure flag (default: false)
  httpOnly: false,                   // HttpOnly flag (default: false)
  sameSite: "Lax",                   // SameSite: Strict|Lax|None (default: "Lax")
  expires: new Date("2024-12-31")    // Expiry date (Date|string|number)
}
```

#### Clear Cookies

```javascript
await pm.cookies.clear(name?);
```

- `name` (string, optional): Specific cookie to clear. If omitted, clears all cookies for the collection.

### Examples

#### Working with Session Cookies

```javascript
// Pre-request script: Check if we have a session
const sessionId = await pm.cookies.get("JSESSIONID");
if (!sessionId) {
  console.log("No session found, will authenticate");
}

// Test script: Save session from response
const setCookieHeader = pm.response.headers.get("Set-Cookie");
if (setCookieHeader && setCookieHeader.includes("JSESSIONID")) {
  console.log("Session cookie received and saved automatically");
}
```

#### Manual Cookie Management

```javascript
// Set a custom cookie
await pm.cookies.set("user_pref", "dark_mode", {
  domain: "myapp.com",
  path: "/",
  expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
});

// Get and use cookie value
const userPref = await pm.cookies.get("user_pref");
if (userPref === "dark_mode") {
  pm.request.headers.upsert({ key: "Theme", value: "dark" });
}
```

#### Clear Expired Sessions

```javascript
// Test script: Clear session on logout
if (pm.response.json().action === "logout") {
  await pm.cookies.clear("JSESSIONID");
  await pm.cookies.clear("auth_token");
  console.log("Session cookies cleared");
}
```

## pm.utils

Utility functions for common operations like encoding, hashing, and random generation.

### Encoding/Decoding

#### Base64

```javascript
const encoded = pm.utils.base64Encode("Hello World");
// Returns: "SGVsbG8gV29ybGQ="

const decoded = pm.utils.base64Decode("SGVsbG8gV29ybGQ=");
// Returns: "Hello World"
```

#### URL Encoding

```javascript
const encoded = pm.utils.urlEncode("hello world & special chars!");
// Returns: "hello%20world%20%26%20special%20chars%21"

const decoded = pm.utils.urlDecode("hello%20world");
// Returns: "hello world"
```

### Hashing

#### SHA1 Hash

```javascript
const hash = await pm.utils.sha1("password123");
// Returns: "482c811da5d5b4bc6d497ffa98491e38"
```

#### SHA256 Hash

```javascript
const hash = await pm.utils.sha256("sensitive data");
// Returns: "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
```

#### MD5 Hash (Simplified)

```javascript
const hash = await pm.utils.md5("test data");
// Returns: 32-character hex string (simplified implementation)
```

### Random Generation

#### UUID

```javascript
const id = pm.utils.uuid();
// Returns: "550e8400-e29b-41d4-a716-446655440000"
```

#### Random Integer

```javascript
const num = pm.utils.randomInt(1, 100);  // 1 to 100 (inclusive)
const port = pm.utils.randomInt(8000, 9000);  // Random port
```

#### Random String

```javascript
const token = pm.utils.randomString(16);  // 16 random alphanumeric chars
const hex = pm.utils.randomString(8, "0123456789ABCDEF");  // 8-char hex
```

### Examples

#### Generate Secure Request ID

```javascript
const requestId = pm.utils.uuid();
pm.request.headers.upsert({ key: "X-Request-ID", value: requestId });
console.log("Added request ID:", requestId);
```

#### Create HMAC-style Signature

```javascript
const timestamp = Date.now().toString();
const method = pm.request.method;
const path = new URL(pm.request.url).pathname;
const body = pm.request.body || "";

const message = `${method}\n${path}\n${timestamp}\n${body}`;
const signature = await pm.utils.sha256(message);

pm.request.headers.upsert({ key: "X-Timestamp", value: timestamp });
pm.request.headers.upsert({ key: "X-Signature", value: signature });
```

#### Generate Test Data

```javascript
const testUser = {
  id: pm.utils.randomInt(1000, 9999),
  username: `user_${pm.utils.randomString(8)}`,
  email: `${pm.utils.randomString(6)}@test.com`,
  session: pm.utils.uuid()
};

pm.request.body = JSON.stringify(testUser);
pm.variables.set("test_user_id", testUser.id.toString());
```

## Variables & Environment

### Setting Variables

```javascript
pm.variables.set("api_key", "abc123");           // Environment variable
pm.globals.set("base_url", "https://api.com");   // Global variable
pm.collectionVariables.set("version", "v2");     // Collection variable
```

### Getting Variables

```javascript
const apiKey = pm.variables.get("api_key");
const baseUrl = pm.globals.get("base_url");
const version = pm.collectionVariables.get("version");

// Use in request URL
pm.request.url = `${baseUrl}/${version}/users`;
pm.request.headers.upsert({ key: "X-API-Key", value: apiKey });
```

### Variable Resolution

Variables resolve in this order (first match wins):
1. Collection variables
2. Environment variables  
3. Global variables

## Testing

### Basic Assertions

```javascript
pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test("Response has data", () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property("data");
  pm.expect(json.data).to.be.an("array");
});
```

### Advanced Testing with sendRequest

```javascript
pm.test("User creation flow", async () => {
  // Create user
  const createResponse = await pm.sendRequest({
    url: "https://api.example.com/users",
    method: "POST",
    body: {
      mode: "raw",
      raw: JSON.stringify({ name: "Test User", email: "test@example.com" })
    }
  });
  
  pm.expect(createResponse.code).to.equal(201);
  const user = createResponse.json();
  
  // Verify user exists
  const getResponse = await pm.sendRequest({
    url: `https://api.example.com/users/${user.id}`
  });
  
  pm.expect(getResponse.code).to.equal(200);
  pm.expect(getResponse.json().name).to.equal("Test User");
});
```

## Examples

### Authentication Flow

```javascript
// Pre-request script
const token = pm.variables.get("auth_token");
if (!token || isTokenExpired(token)) {
  // Get new token
  const authResponse = await pm.sendRequest({
    url: "https://api.example.com/auth/token",
    method: "POST",
    body: {
      mode: "raw",
      raw: JSON.stringify({
        client_id: pm.variables.get("client_id"),
        client_secret: pm.variables.get("client_secret")
      })
    }
  });
  
  const newToken = authResponse.json().access_token;
  pm.variables.set("auth_token", newToken);
  pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${newToken}` });
}

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(pm.utils.base64Decode(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
```

### Data Validation Chain

```javascript
// Test script
pm.test("Complete data validation", async () => {
  const response = pm.response.json();
  
  // Validate required fields
  pm.expect(response).to.have.property("id");
  pm.expect(response).to.have.property("email");
  
  // Verify email format with external service
  const emailCheck = await pm.sendRequest({
    url: `https://api.emailvalidation.com/check`,
    method: "GET",
    header: {
      "Authorization": `Bearer ${pm.variables.get("email_api_key")}`
    },
    body: {
      mode: "urlencoded",
      urlencoded: [
        { key: "email", value: response.email }
      ]
    }
  });
  
  const emailValidation = emailCheck.json();
  pm.expect(emailValidation.valid).to.equal(true);
  
  // Store validation results
  pm.variables.set("last_validated_email", response.email);
  pm.variables.set("validation_timestamp", Date.now().toString());
});
```

### Performance Monitoring

```javascript
// Pre-request script
const startTime = Date.now();
pm.variables.set("request_start_time", startTime.toString());

// Test script
const startTime = parseInt(pm.variables.get("request_start_time"));
const endTime = Date.now();
const totalTime = endTime - startTime;

pm.test(`Response time under 2s (actual: ${totalTime}ms)`, () => {
  pm.expect(totalTime).to.be.below(2000);
});

// Log performance data
console.log(`Total request time: ${totalTime}ms`);
console.log(`Network time: ${pm.response.responseTime}ms`);
console.log(`Script overhead: ${totalTime - pm.response.responseTime}ms`);
```

---

## Summary

Ripple's enhanced script runtime provides:

✅ **pm.sendRequest()** - Full HTTP client for chaining requests
✅ **pm.cookies** - Complete cookie management API  
✅ **pm.utils** - Crypto, encoding, and random generation utilities
✅ **Async/await** support throughout
✅ **Full Postman compatibility** for existing scripts

This enables powerful testing workflows, authentication flows, data validation chains, and complex API integrations directly within your Ripple collections.