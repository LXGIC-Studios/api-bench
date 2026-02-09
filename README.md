# api-bench

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/api-bench.svg)](https://www.npmjs.com/package/@lxgicstudios/api-bench)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Benchmark your API endpoints right from the terminal. Sends N requests with C concurrency and gives you the numbers that matter: min/max/avg latency, p95, p99, RPS, and error rates.

## Install

```bash
npm install -g @lxgicstudios/api-bench
```

Or run directly:

```bash
npx @lxgicstudios/api-bench https://api.example.com/health
```

## Features

- **Concurrency control** - Set exactly how many parallel requests you want
- **Latency percentiles** - Get p50, p95, and p99 numbers
- **RPS calculation** - Requests per second throughput
- **Error tracking** - Status codes and error rate breakdown
- **Compare mode** - Benchmark two URLs side by side
- **Ramp-up mode** - Gradually increase concurrency to find breaking points
- **POST support** - Send custom bodies and headers
- **JSON output** - Pipe results to other tools
- **Zero dependencies** - Built with Node.js builtins only
- **Progress bar** - See what's happening in real-time

## Usage

```bash
# Basic benchmark (100 requests, 10 concurrent)
api-bench https://api.example.com/health

# Heavy load test
api-bench https://api.example.com -n 1000 -c 100

# POST with JSON body
api-bench https://api.example.com/data -m POST \
  -b '{"name":"test"}' \
  -H 'Content-Type: application/json'

# Compare two endpoints
api-bench https://api-v1.example.com/users \
  --compare https://api-v2.example.com/users

# Ramp up concurrency gradually
api-bench https://api.example.com -n 500 -c 100 --ramp

# JSON output for CI/CD
api-bench https://api.example.com --json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --requests <num>` | Total number of requests | `100` |
| `-c, --concurrency <num>` | Concurrent requests | `10` |
| `-m, --method <method>` | HTTP method | `GET` |
| `-H, --header <header>` | Add header (repeatable) | - |
| `-b, --body <data>` | Request body | - |
| `-t, --timeout <ms>` | Request timeout | `10000` |
| `--compare <url>` | Compare against second URL | - |
| `--ramp` | Gradually increase concurrency | `false` |
| `--ramp-steps <num>` | Number of ramp steps | `5` |
| `--json` | Output results as JSON | `false` |
| `--help` | Show help | - |

## Output Example

```
 BENCHMARK RESULTS

  URL:          https://api.example.com/health
  Method:       GET
  Requests:     100
  Concurrency:  10
  Total Time:   2.34s

  Latency
  ────────────────────────────────────────
  Min:          12.3ms
  Max:          89.7ms
  Avg:          23.4ms
  Median:       21.1ms
  p95:          45.2ms
  p99:          78.3ms

  Throughput
  ────────────────────────────────────────
  RPS:          42.7 req/s
  Data:         125.4KB
```

---

**Built by [LXGIC Studios](https://lxgicstudios.com)**

[GitHub](https://github.com/lxgicstudios/api-bench) | [Twitter](https://x.com/lxgicstudios)
