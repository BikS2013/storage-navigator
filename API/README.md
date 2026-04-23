# Storage Navigator API

See `docs/design/plan-006-rbac-api.md` for the full design.

## Quickstart (local)

1. `cp .env.example .env` and fill in required values (or set `AUTH_ENABLED=false` + `ANON_ROLE=Reader` for unauthenticated dev).
2. `npm install`
3. `npm run dev`
4. `curl http://localhost:3000/healthz`
