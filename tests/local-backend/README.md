# Local backend integration

Run `node tests/local-backend/run.mjs` from the repository root with Node 22+ and a healthy local Docker daemon. The runner uses pinned official images, generated test-only credentials, fake accounts/data, and real local GoTrue/PostgREST HTTP responses. It removes its uniquely named resources afterward. It never connects to a hosted Supabase project.

See `docs/donna/LOCAL-BACKEND-QA.md` for exact scope and limitations. Do not use this harness with customer data or replace its local Docker endpoint/transport with hosted infrastructure.
