# Maestro Workspace API Usage

The Maestro Workspace API is now accessible from external applications via CORS. This allows other tools and dashboards to interact with your workspace data directly.

## Base URL

All workspace API endpoints are prefixed with:
`http://localhost:3000/api/workspace`

## CORS Policy

The API implements a permissive CORS policy for the workspace endpoints:
- **Allowed Origin**: `*` (All origins)
- **Allowed Methods**: `GET, POST, PUT, DELETE, OPTIONS`
- **Allowed Headers**: `Content-Type, Authorization`

## Endpoints

### Context
- **GET** `/api/workspace/context`
  - Retrieves the current workspace context.

### Entities (Agents, Skills, Chains, Templates)
- **GET** `/api/workspace/[type]/[slug]`
  - Retrieves a specific entity.
- **POST** `/api/workspace/[type]/[slug]`
  - Creates or updates an entity.

### Versions
- **GET** `/api/workspace/[type]/[slug]/versions`
  - Retrieves version history for an entity.

## Examples

### JavaScript Fetch

```javascript
const baseUrl = 'http://localhost:3000/api/workspace';

// Fetch workspace context
async function getContext() {
  const response = await fetch(`${baseUrl}/context`);
  const data = await response.json();
  console.log(data);
}

// Fetch a specific agent
async function getAgent(slug) {
  const response = await fetch(`${baseUrl}/agent/${slug}`);
  const agent = await response.json();
  console.log(agent);
}
```

### cURL

```bash
# Get workspace context
curl -X GET http://localhost:3000/api/workspace/context

# Get a specific agent
curl -X GET http://localhost:3000/api/workspace/agent/world-builder
```

## Verification

You can verify the CORS headers using the provided test script:
```bash
node tests/verify-cors.js
```
Note: The server must be running (`npm run dev`) for the live header check to pass.
