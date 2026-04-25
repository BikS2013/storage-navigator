<storage-nav-api>
    <objective>
        HTTP API that brokers Azure Blob and Azure Files access behind toggleable OIDC and three global roles (StorageReader, StorageWriter, StorageAdmin). Designed to be a third backend type for the Storage Navigator client. Implemented in the `API/` folder as a separate deployable.
    </objective>
    <command>
        cd API && npm run dev
    </command>
    <info>
        Lives in the `API/` folder at repo root. Own package.json, own deploy artifact (Azure App Service, Linux, Node 22).

        Auth: in-app OIDC via NBG IdentityServer (`https://my.nbg.gr/identity`). JWT validated locally via JWKS (`jose`). Toggleable with `AUTH_ENABLED=true|false`; when false `ANON_ROLE` env decides default role.

        Static auth header (perimeter API key, Plan 008):
        STATIC_AUTH_HEADER_VALUE   When set, every protected route requires this header
                                   value. Comma-separated list = zero-downtime rotation.
                                   Typically referenced from Key Vault:
                                   @Microsoft.KeyVault(VaultName=...;SecretName=...)
        STATIC_AUTH_HEADER_NAME    Header name (default: X-Storage-Nav-Auth)

        Storage access: `DefaultAzureCredential` from `@azure/identity` resolves to System-Assigned MI on App Service and `az login` locally. Storage account discovery via `@azure/arm-storage` (MI needs Reader on subscription).

        URL shape: `/storages/{account}/containers[/{c}/blobs[/{path}]]` and `/storages/{account}/shares[/{s}/files[/{path}]]`. Discovery: `/.well-known/storage-nav-config`. Health: `/healthz`, `/readyz`. OpenAPI: `/openapi.yaml`, swagger UI at `/docs`.

        Commands (from `API/`):
          npm run dev                # tsx watch
          npm run build              # tsc -> dist/
          npm start                  # node dist/index.js
          npm run test               # vitest run
          npm run test:unit
          npm run test:integration   # Azurite + mock IdP
          npm run lint:openapi

        Design: `docs/design/plan-006-rbac-api.md`. Implementation plan: `docs/design/plan-006-rbac-api-impl.md`.
    </info>
</storage-nav-api>
