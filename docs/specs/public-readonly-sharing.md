# Public read-only result sharing

Status: accepted for implementation (28 Jul 2026)

## Objective

Let an authenticated Synapse engineer publish a frozen, read-only snapshot of
the current engineering workspace and send it to a recipient who does not have
a Synapse account. The initial shareable result kinds are:

- GW Alignment
- Sectioning
- final ILI Alignment
- Corrosion Analysis
- FFS

The recipient can search the shared table and open row details, but cannot
change the source record, save a review, run an analysis, or call an edit API.
The link owner can revoke access. Links expire after 30 days by default.

This is a collaboration surface, not an approval record. Every public view must
state that the snapshot is decision support and still requires qualified
engineering review.

## Assumptions and decisions

| Topic | Decision |
| --- | --- |
| Shared state | An immutable snapshot of what the owner saw when they clicked Share |
| Authentication | No login for the recipient; possession of the full link grants read-only access |
| Link format | `/share/:publicId#:secret`; the secret remains in the URI fragment |
| Secret storage | 32 cryptographically random bytes; store only its SHA-256 digest |
| Lifetime | Owner chooses 7, 30, or 90 days; 30 days is the default |
| Revocation | Owner can revoke an active link; revoked/expired/invalid links return the same unavailable response |
| Who can share | `engineer`, `admin`, and organization-scoped `super_admin`; `viewer` and `user` cannot publish |
| Public actions | One bounded `GET`; no anonymous create, update, export, or delete endpoint |
| Payload | Versioned normalized snapshot: summary values, columns, rows, and notes |
| Size | At most 5 MiB of serialized JSON and 10,000 rows |

## Threat model

### Trust boundaries and assets

- Authenticated browser to the share-creation API: untrusted request payload
  crosses into tenant-owned persistence.
- Anonymous browser to the public read API: a bearer secret crosses into the
  server and grants access to one snapshot only.
- Public snapshot payload to the DOM: stored data is untrusted display content.
- Assets at risk: tenant engineering data, the source analysis, user identity,
  and availability of the anonymous endpoint.

### Abuse cases and controls

| Abuse case | Control |
| --- | --- |
| Guess a link | 256-bit random secret and independent random public UUID |
| Database leak reveals live links | Persist only a SHA-256 digest of the secret |
| Secret leaks through HTTP request/access logs | Put the secret after `#`; fragments are not sent in HTTP requests |
| Brute-force public IDs/secrets | Per-IP public endpoint rate limit plus generic 404 response |
| Share a huge payload to exhaust storage | 5 MiB serialized limit and 10,000-row cap |
| Viewer calls an edit route | Public route exposes `GET` only; the viewer UI contains no editor components |
| Cross-tenant revoke/list | Every owner operation is scoped by `organization_id` |
| Viewer role publishes externally | Explicit share-publisher role middleware |
| Stored XSS in snapshot | React text rendering only; no `innerHTML` |
| Old link remains valid forever | Required expiry and owner revocation |

The design follows OWASP's deny-by-default and per-request authorization
guidance, and adapts its URL-token guidance: cryptographically safe random
tokens, secure storage, expiry, generic failure, and rate limiting.

## API contract

All error responses use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### `POST /api/public-shares`

Authenticated publisher only.

```json
{
  "kind": "ILI_ALIGNMENT",
  "title": "KP 12–24 final alignment",
  "sourceRef": "alignment-session:42",
  "expiresInDays": 30,
  "snapshot": {
    "version": 1,
    "summary": [{ "label": "Matched", "value": 842 }],
    "columns": [{ "key": "sourceKey", "label": "Source key" }],
    "rows": [{ "sourceKey": "NEW:123" }],
    "notes": ["Final alignment snapshot"]
  }
}
```

Returns `201`. `accessToken` is returned once and is never persisted or returned
by a list endpoint.

```json
{
  "share": {
    "id": "uuid",
    "kind": "ILI_ALIGNMENT",
    "title": "KP 12–24 final alignment",
    "expiresAt": "2026-08-27T00:00:00.000Z",
    "accessToken": "base64url-secret"
  }
}
```

### `GET /api/public-shares`

Authenticated publisher. Lists metadata for the caller's organization, bounded
to 100 newest rows. Optional `kind` and `sourceRef` filters are validated.
Secrets and snapshot bodies are excluded.

### `DELETE /api/public-shares/:id`

Authenticated publisher. Tenant-scoped, idempotent revocation. Returns `204`
when the share is already revoked and `404` when the ID is not owned.

### `GET /api/public-shares/:id`

Anonymous and rate-limited. Requires `X-Share-Token`. Returns the immutable
snapshot only when the ID, digest, expiry, and revocation state all pass.
Otherwise returns the same `404 SHARE_UNAVAILABLE` envelope.

The response adds `Cache-Control: private, no-store` and
`Referrer-Policy: no-referrer`.

## Tech stack and project structure

- React 19.2, TypeScript 6, React Router 7, Vite 8
- Express 5.2 on Node 22
- PostgreSQL with additive SQL migrations
- Node's built-in test runner

Relevant additions:

```text
backend/migrations/011_public_readonly_shares.sql
backend/src/modules/publicShares/
backend/tests/public_shares.test.js
frontend/src/components/sharing/
frontend/src/pages/PublicShare/
frontend/src/lib/sharing/
frontend/tests/publicShareSnapshot.test.ts
```

## Commands

```bash
npm test --prefix backend
npm run check --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

## Code style

Follow existing CommonJS backend modules and named TypeScript helpers. Validate
at the HTTP boundary and keep repository functions parameterized:

```js
async function findPublicShare(pool, publicId) {
    const result = await pool.query(
        `SELECT * FROM public_result_shares WHERE public_id = $1`,
        [publicId],
    );
    return result.rows[0] || null;
}
```

## Testing strategy

- Contract unit tests: kind, title, expiry, snapshot shape, row count, and byte
  limits.
- Controller tests: role gate, secret hashing/one-time return, generic public
  failure, expiry/revocation, tenant-scoped revocation, and no-store headers.
- Repository tests: parameterized tenant filters are exercised with fakes.
- Frontend unit tests: each supported workspace normalizes into a valid public
  snapshot without carrying edit callbacks or browser-only objects.
- Production build, lint, and a manual anonymous browser pass.

## Boundaries

- Always: freeze a snapshot, hash the secret, tenant-scope owner operations,
  rate-limit anonymous reads, encode rendered content, and show the
  decision-support disclaimer.
- Ask first: making links permanent, enabling anonymous downloads, changing
  which roles may publish, or sharing live data that changes after publication.
- Never: store plaintext link secrets, reuse an authenticated edit component in
  the public route, expose source tenant/user IDs, or log the secret.

## Success criteria

- A permitted user can create and copy a link from all five result workspaces.
- The link opens in a logged-out/private browser and renders a useful read-only
  view with searchable rows and clickable row detail.
- No public mutation endpoint exists and viewer UI has no edit controls.
- Invalid, revoked, and expired links are indistinguishable to anonymous users.
- Owner can revoke the link and access stops immediately.
- Secrets do not appear in database rows or HTTP paths.
- Backend tests/check and frontend tests/lint/build pass.

## Official implementation references

- Node crypto:
  https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
- Express 5 router middleware:
  https://expressjs.com/en/5x/api/router/
- React Router declarative routes and dynamic segments:
  https://reactrouter.com/start/declarative/routing
- React Effect setup and cleanup:
  https://react.dev/reference/react/useEffect
- PostgreSQL JSON types:
  https://www.postgresql.org/docs/current/datatype-json.html
- OWASP Authorization Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP URL-token guidance:
  https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- URI fragment behavior:
  https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
