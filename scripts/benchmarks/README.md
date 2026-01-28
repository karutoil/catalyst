# Benchmarks

This folder contains lightweight, reproducible benchmarks for Catalyst.

## HTTP Bench

Runs rate-limit-safe `autocannon` benchmarks against a running backend.

```bash
BASE_URL=http://localhost:3000 \
EMAIL=admin@example.com PASSWORD=admin123 \
./scripts/benchmarks/http-bench.sh
```

Notes:
- `/health` is rate limited (configured higher than most routes), so the script keeps the request rate low.
- Authenticated endpoints are also rate-limited (typically per-user), so the script uses conservative RPS by default.
- For higher-throughput benchmarks, temporarily increase rate limits in the backend config and clearly document the settings used.
