#!/usr/bin/env node

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
};

interface BenchConfig {
  url: string;
  requests: number;
  concurrency: number;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeout: number;
  ramp: boolean;
  rampSteps: number;
}

interface RequestResult {
  status: number;
  latency: number;
  error?: string;
  bytes: number;
}

interface BenchReport {
  url: string;
  method: string;
  totalRequests: number;
  concurrency: number;
  totalTime: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  rps: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    median: number;
    p95: number;
    p99: number;
    stddev: number;
  };
  statusCodes: Record<number, number>;
  totalBytes: number;
}

function makeRequest(config: BenchConfig): Promise<RequestResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = new URL(config.url);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: config.method,
      headers: { ...config.headers },
      timeout: config.timeout,
    };

    const hdrs = options.headers as Record<string, string>;
    if (config.body && !hdrs['Content-Length']) {
      hdrs['Content-Length'] = Buffer.byteLength(config.body).toString();
    }

    const req = lib.request(options, (res) => {
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      res.on('end', () => {
        const latency = performance.now() - start;
        resolve({
          status: res.statusCode || 0,
          latency,
          bytes,
        });
      });
    });

    req.on('error', (err) => {
      const latency = performance.now() - start;
      resolve({
        status: 0,
        latency,
        error: err.message,
        bytes: 0,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = performance.now() - start;
      resolve({
        status: 0,
        latency,
        error: 'timeout',
        bytes: 0,
      });
    });

    if (config.body) {
      req.write(config.body);
    }

    req.end();
  });
}

async function runBatch(config: BenchConfig, count: number, concurrency: number): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  let completed = 0;
  let running = 0;
  let idx = 0;

  return new Promise((resolve) => {
    function next(): void {
      while (running < concurrency && idx < count) {
        running++;
        idx++;
        makeRequest(config).then((result) => {
          results.push(result);
          completed++;
          running--;

          // Progress
          const pct = Math.floor((completed / count) * 100);
          const bar = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2));
          process.stdout.write(`\r  ${c.cyan}${bar}${c.reset} ${pct}% (${completed}/${count})`);

          if (completed === count) {
            process.stdout.write('\n');
            resolve(results);
          } else {
            next();
          }
        });
      }
    }
    next();
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stddev(values: number[], avg: number): number {
  const sqDiffs = values.map(v => (v - avg) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function analyze(results: RequestResult[], config: BenchConfig, totalTime: number): BenchReport {
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const successResults = results.filter(r => !r.error && r.status >= 200 && r.status < 400);
  const errorResults = results.filter(r => r.error || r.status >= 400 || r.status === 0);

  const statusCodes: Record<number, number> = {};
  for (const r of results) {
    statusCodes[r.status] = (statusCodes[r.status] || 0) + 1;
  }

  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  return {
    url: config.url,
    method: config.method,
    totalRequests: results.length,
    concurrency: config.concurrency,
    totalTime,
    successCount: successResults.length,
    errorCount: errorResults.length,
    errorRate: (errorResults.length / results.length) * 100,
    rps: results.length / (totalTime / 1000),
    latency: {
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg,
      median: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      stddev: stddev(latencies, avg),
    },
    statusCodes,
    totalBytes: results.reduce((a, r) => a + r.bytes, 0),
  };
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function printReport(report: BenchReport): void {
  const errorColor = report.errorRate > 0 ? c.red : c.green;

  console.log(`
${c.bgBlue}${c.white}${c.bold} BENCHMARK RESULTS ${c.reset}

  ${c.bold}URL:${c.reset}          ${report.url}
  ${c.bold}Method:${c.reset}       ${report.method}
  ${c.bold}Requests:${c.reset}     ${report.totalRequests}
  ${c.bold}Concurrency:${c.reset}  ${report.concurrency}
  ${c.bold}Total Time:${c.reset}   ${formatMs(report.totalTime)}

${c.yellow}${c.bold}  Latency${c.reset}
  ${c.dim}${'─'.repeat(40)}${c.reset}
  ${c.bold}Min:${c.reset}          ${formatMs(report.latency.min)}
  ${c.bold}Max:${c.reset}          ${formatMs(report.latency.max)}
  ${c.bold}Avg:${c.reset}          ${formatMs(report.latency.avg)}
  ${c.bold}Median:${c.reset}       ${formatMs(report.latency.median)}
  ${c.bold}p95:${c.reset}          ${c.yellow}${formatMs(report.latency.p95)}${c.reset}
  ${c.bold}p99:${c.reset}          ${c.red}${formatMs(report.latency.p99)}${c.reset}
  ${c.bold}Std Dev:${c.reset}      ${formatMs(report.latency.stddev)}

${c.cyan}${c.bold}  Throughput${c.reset}
  ${c.dim}${'─'.repeat(40)}${c.reset}
  ${c.bold}RPS:${c.reset}          ${c.green}${report.rps.toFixed(1)}${c.reset} req/s
  ${c.bold}Data:${c.reset}         ${formatBytes(report.totalBytes)}

${c.magenta}${c.bold}  Results${c.reset}
  ${c.dim}${'─'.repeat(40)}${c.reset}
  ${c.bold}Success:${c.reset}      ${c.green}${report.successCount}${c.reset}
  ${c.bold}Errors:${c.reset}       ${errorColor}${report.errorCount}${c.reset}
  ${c.bold}Error Rate:${c.reset}   ${errorColor}${report.errorRate.toFixed(1)}%${c.reset}

  ${c.bold}Status Codes:${c.reset}`);

  for (const [code, count] of Object.entries(report.statusCodes)) {
    const statusColor = parseInt(code) < 400 ? c.green : c.red;
    console.log(`    ${statusColor}${code}${c.reset}: ${count}`);
  }
  console.log();
}

function printCompare(report1: BenchReport, report2: BenchReport): void {
  console.log(`\n${c.bgGreen}${c.white}${c.bold} COMPARISON ${c.reset}\n`);

  const rows: [string, string, string, string][] = [
    ['Metric', 'URL 1', 'URL 2', 'Diff'],
    ['Avg Latency', formatMs(report1.latency.avg), formatMs(report2.latency.avg),
      `${((report2.latency.avg - report1.latency.avg) / report1.latency.avg * 100).toFixed(1)}%`],
    ['p95 Latency', formatMs(report1.latency.p95), formatMs(report2.latency.p95),
      `${((report2.latency.p95 - report1.latency.p95) / report1.latency.p95 * 100).toFixed(1)}%`],
    ['p99 Latency', formatMs(report1.latency.p99), formatMs(report2.latency.p99),
      `${((report2.latency.p99 - report1.latency.p99) / report1.latency.p99 * 100).toFixed(1)}%`],
    ['RPS', report1.rps.toFixed(1), report2.rps.toFixed(1),
      `${((report2.rps - report1.rps) / report1.rps * 100).toFixed(1)}%`],
    ['Error Rate', `${report1.errorRate.toFixed(1)}%`, `${report2.errorRate.toFixed(1)}%`, '-'],
  ];

  for (const [metric, v1, v2, diff] of rows) {
    if (metric === 'Metric') {
      console.log(`  ${c.bold}${metric.padEnd(15)}${v1.padEnd(15)}${v2.padEnd(15)}${diff}${c.reset}`);
      console.log(`  ${c.dim}${'─'.repeat(55)}${c.reset}`);
    } else {
      const diffColor = diff.startsWith('-') ? c.green : c.red;
      console.log(`  ${metric.padEnd(15)}${v1.padEnd(15)}${v2.padEnd(15)}${diffColor}${diff}${c.reset}`);
    }
  }
  console.log();
}

function printHelp(): void {
  console.log(`
${c.bgBlue}${c.white}${c.bold} api-bench ${c.reset} ${c.dim}v1.0.0${c.reset}

${c.bold}Benchmark API endpoint performance${c.reset}

${c.yellow}USAGE${c.reset}
  ${c.cyan}api-bench${c.reset} <url> [options]

${c.yellow}OPTIONS${c.reset}
  ${c.green}-n, --requests${c.reset} <num>       Number of requests (default: 100)
  ${c.green}-c, --concurrency${c.reset} <num>    Concurrent requests (default: 10)
  ${c.green}-m, --method${c.reset} <method>      HTTP method (default: GET)
  ${c.green}-H, --header${c.reset} <header>      Add header (repeatable)
  ${c.green}-b, --body${c.reset} <data>          Request body
  ${c.green}-t, --timeout${c.reset} <ms>         Request timeout in ms (default: 10000)
  ${c.green}--compare${c.reset} <url>            Compare against second URL
  ${c.green}--ramp${c.reset}                     Gradually increase concurrency
  ${c.green}--ramp-steps${c.reset} <num>         Number of ramp steps (default: 5)
  ${c.green}--json${c.reset}                     Output results as JSON
  ${c.green}--help${c.reset}                     Show this help
  ${c.green}--version${c.reset}                  Show version

${c.yellow}EXAMPLES${c.reset}
  ${c.dim}# Basic benchmark${c.reset}
  api-bench https://api.example.com/health

  ${c.dim}# 500 requests with 50 concurrent${c.reset}
  api-bench https://api.example.com -n 500 -c 50

  ${c.dim}# POST with body${c.reset}
  api-bench https://api.example.com/data -m POST -b '{"key":"value"}' -H 'Content-Type: application/json'

  ${c.dim}# Compare two endpoints${c.reset}
  api-bench https://api-v1.example.com --compare https://api-v2.example.com

  ${c.dim}# Gradual concurrency ramp-up${c.reset}
  api-bench https://api.example.com -n 200 -c 50 --ramp
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('api-bench v1.0.0');
    process.exit(0);
  }

  const config: BenchConfig = {
    url: '',
    requests: 100,
    concurrency: 10,
    method: 'GET',
    headers: {},
    timeout: 10000,
    ramp: false,
    rampSteps: 5,
  };

  let compareUrl = '';
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-n':
      case '--requests':
        config.requests = parseInt(args[++i]) || 100;
        break;
      case '-c':
      case '--concurrency':
        config.concurrency = parseInt(args[++i]) || 10;
        break;
      case '-m':
      case '--method':
        config.method = (args[++i] || 'GET').toUpperCase();
        break;
      case '-H':
      case '--header': {
        const header = args[++i];
        if (header) {
          const colonIdx = header.indexOf(':');
          if (colonIdx > 0) {
            config.headers[header.substring(0, colonIdx).trim()] = header.substring(colonIdx + 1).trim();
          }
        }
        break;
      }
      case '-b':
      case '--body':
        config.body = args[++i];
        break;
      case '-t':
      case '--timeout':
        config.timeout = parseInt(args[++i]) || 10000;
        break;
      case '--compare':
        compareUrl = args[++i] || '';
        break;
      case '--ramp':
        config.ramp = true;
        break;
      case '--ramp-steps':
        config.rampSteps = parseInt(args[++i]) || 5;
        break;
      case '--json':
        jsonOutput = true;
        break;
      default:
        if (!args[i].startsWith('-') && !config.url) {
          config.url = args[i];
        }
        break;
    }
  }

  if (!config.url) {
    console.error(`${c.red}Error:${c.reset} No URL provided.`);
    process.exit(1);
  }

  console.log(`\n${c.bgBlue}${c.white}${c.bold} api-bench ${c.reset} ${c.dim}Benchmarking...${c.reset}\n`);
  console.log(`  ${c.bold}Target:${c.reset}       ${config.url}`);
  console.log(`  ${c.bold}Method:${c.reset}       ${config.method}`);
  console.log(`  ${c.bold}Requests:${c.reset}     ${config.requests}`);
  console.log(`  ${c.bold}Concurrency:${c.reset}  ${config.concurrency}`);
  if (config.ramp) console.log(`  ${c.bold}Ramp:${c.reset}         ${config.rampSteps} steps`);
  console.log();

  if (config.ramp) {
    // Ramp mode: gradually increase concurrency
    const step = Math.ceil(config.concurrency / config.rampSteps);
    const requestsPerStep = Math.ceil(config.requests / config.rampSteps);

    console.log(`${c.yellow}${c.bold}  Ramp-up Mode${c.reset}\n`);

    const allResults: RequestResult[] = [];
    const overallStart = performance.now();

    for (let s = 1; s <= config.rampSteps; s++) {
      const currentConcurrency = Math.min(step * s, config.concurrency);
      console.log(`  ${c.cyan}Step ${s}/${config.rampSteps}:${c.reset} concurrency=${currentConcurrency}`);
      const stepResults = await runBatch(config, requestsPerStep, currentConcurrency);
      allResults.push(...stepResults);

      const stepAvg = stepResults.reduce((a, r) => a + r.latency, 0) / stepResults.length;
      console.log(`    ${c.dim}avg: ${formatMs(stepAvg)}${c.reset}\n`);
    }

    const overallTime = performance.now() - overallStart;
    const report = analyze(allResults, config, overallTime);
    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } else if (compareUrl) {
    // Compare mode
    console.log(`  ${c.cyan}Benchmarking URL 1...${c.reset}`);
    const start1 = performance.now();
    const results1 = await runBatch(config, config.requests, config.concurrency);
    const time1 = performance.now() - start1;
    const report1 = analyze(results1, config, time1);

    console.log(`\n  ${c.cyan}Benchmarking URL 2...${c.reset}`);
    const config2 = { ...config, url: compareUrl };
    const start2 = performance.now();
    const results2 = await runBatch(config2, config.requests, config.concurrency);
    const time2 = performance.now() - start2;
    const report2 = analyze(results2, config2, time2);

    if (jsonOutput) {
      console.log(JSON.stringify({ url1: report1, url2: report2 }, null, 2));
    } else {
      printReport(report1);
      printReport(report2);
      printCompare(report1, report2);
    }
  } else {
    // Normal mode
    const start = performance.now();
    const results = await runBatch(config, config.requests, config.concurrency);
    const totalTime = performance.now() - start;
    const report = analyze(results, config, totalTime);

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  }
}

main().catch((err) => {
  console.error(`${c.red}Error:${c.reset}`, err.message);
  process.exit(1);
});
