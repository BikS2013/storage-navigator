# Storage Navigator API

HTTP API that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (`StorageReader`, `StorageWriter`, `StorageAdmin`). Designed to be the third backend type for the Storage Navigator client. Full design lives at `docs/design/plan-006-rbac-api.md`.

## Quickstart — local, auth disabled

```bash
cd API
cp .env.example .env
# Edit .env: AUTH_ENABLED=false, ANON_ROLE=Admin
npm install
npm run dev
```

Then:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/.well-known/storage-nav-config
curl http://localhost:3000/storages
```

(`/storages` requires reachable Azure credentials. Use `az login` locally — `DefaultAzureCredential` picks it up.)

## Quickstart — local, auth enabled (mock IdP)

Run the integration test suite — it spins up the mock IdP and Azurite and exercises every route end-to-end:

```bash
npm run test:integration
```

## Configuration

See `.env.example` for every supported variable. All required vars are validated at boot via zod; missing required vars cause the process to refuse to start (no fallbacks — by project rule).

| Var | Required | Purpose |
|---|---|---|
| `AUTH_ENABLED` | always | `true` or `false` |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`, `OIDC_SCOPES`, `ROLE_MAP` | when `AUTH_ENABLED=true` | OIDC + role mapping |
| `ANON_ROLE` | when `AUTH_ENABLED=false` | Default role for anonymous callers |

## Testing

- `npm run test:unit` — vitest unit tests, no external deps
- `npm run test:integration` — spins up Azurite + mock IdP via the helpers in `test/helpers/`
- `npm run lint:openapi` — validates `openapi.yaml`

## Docker

```bash
docker build -t storage-navigator-api:dev .
docker run -p 3000:3000 --env-file .env storage-navigator-api:dev
```

## Endpoints

See `openapi.yaml` (also served at `GET /openapi.yaml`; `GET /docs` for Swagger UI when `SWAGGER_UI_ENABLED=true`).

## Deployment

Designed for Azure App Service (Linux, Node 22) with System-Assigned Managed Identity. MI requires:

- `Reader` on the in-scope subscription(s) for ARM enumeration
- `Storage Blob Data Contributor` on each storage account
- `Storage File Data Privileged Contributor` on each storage account (for OAuth-on-Files-REST)

Deploy via container image to ACR + App Service.
