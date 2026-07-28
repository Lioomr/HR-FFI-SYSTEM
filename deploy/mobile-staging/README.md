# Mobile API staging deployment

This Compose stack is for the isolated mobile validation environment at
`api-mobile-dev.asecopro.com`. It must use an empty PostgreSQL volume and a
fresh `.env.staging` generated on the server; do not copy any production env
file, database, media, notification credential, or employee data into it.

Only Caddy exposes ports 80 and 443. PostgreSQL, Redis, and Django stay on the
internal Compose network.
