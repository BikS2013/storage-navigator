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
| `STATIC_AUTH_HEADER_VALUE` | optional | Perimeter static-header gate (Plan 008). When set, every protected route requires this exact value in the request header. Comma-separated list = zero-downtime rotation (any value in the list passes). Typically a Key Vault reference: `@Microsoft.KeyVault(VaultName=...;SecretName=...)`. Unset = gate disabled. |
| `STATIC_AUTH_HEADER_NAME` | optional | Header name for the static-auth gate. Default: `X-Storage-Nav-Auth`. |

## Perimeter static-auth header (Plan 008)

Optional API-key gate that wraps every protected route in front of OIDC. Designed for deploys where the API has Storage Blob Data Contributor via Managed Identity (so callers can't be compromised by leaked tokens) but you still want a tenancy boundary at the edge.

Behavior:
- Unset `STATIC_AUTH_HEADER_VALUE` → gate disabled, no change in behavior.
- Set → every protected route returns `401 STATIC_AUTH_FAILED` unless the request carries a header whose value matches one of the comma-separated values.
- `/healthz`, `/readyz`, `/.well-known/storage-nav-config`, `/openapi.yaml`, `/docs` are public — the gate sits after them.
- Discovery exposes `staticAuthHeaderRequired:true` + `staticAuthHeaderName` (never the value), so clients can prompt for the secret at registration time.
- Rotation: append the new value to the CSV, redeploy/restart, hand new clients the new value, then remove the old after rollover.

### Wiring on Azure App Service

```bash
# 1. Store secret in Key Vault
az keyvault secret set --vault-name <vault> --name storage-nav-static-auth --value "<random-40-char>"

# 2. Grant App Service MI access to the vault
az role assignment create \
  --assignee-object-id <app-service-MI-principal-id> \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>"

# 3. Wire env var as Key Vault reference
az webapp config appsettings set --name <webapp> --resource-group <rg> --settings \
  "STATIC_AUTH_HEADER_VALUE=@Microsoft.KeyVault(VaultName=<vault>;SecretName=storage-nav-static-auth)"

# 4. Restart
az webapp restart --name <webapp> --resource-group <rg>
```

Verify resolution:

```bash
az rest --method GET --uri "https://management.azure.com/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/<webapp>/config/configreferences/appsettings/STATIC_AUTH_HEADER_VALUE?api-version=2022-03-01" \
  --query "properties.{status:status, details:details}"
# expect status: Resolved
```

Smoke-test:

```bash
curl -i https://<webapp>.azurewebsites.net/storages                                           # 401 STATIC_AUTH_FAILED
curl -i -H "X-Storage-Nav-Auth: <secret>" https://<webapp>.azurewebsites.net/storages         # 200
```

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
