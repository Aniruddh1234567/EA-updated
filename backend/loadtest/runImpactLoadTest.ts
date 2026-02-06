import { RepositoryGraphAbstractionLayer } from '../graph/RepositoryGraphAbstractionLayer';
import { ImpactAnalysisEngine } from '../analysis/ImpactAnalysisEngine';
import type { ImpactAnalysisRequest } from '../analysis/ImpactAnalysisRequest';

import { generateSyntheticDataset } from './SyntheticDatasetGenerator';
import { SeededRandom } from './SeededRandom';

const nowMs = (): number => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perf = (globalThis as any)?.performance;
  if (perf && typeof perf.now === 'function') return perf.now();
  return Date.now();
};

const asInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const asFloat = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const asString = (value: string | undefined, fallback: string): string => (value ?? '').trim() || fallback;

const asBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return fallback;
};

type Args = {
  seed: number;

  programmes: number;
  capabilities: number;
  capabilityHierarchyDepth: number;
  capabilityBranching: number;
  businessProcesses: number;
  applications: number;
  technologies: number;

  dependencyFanout: number;
  appChainDepth: number;
  programmeImpactsPerProgramme: number;

  runs: number;
  concurrency: number;

  rootKind: 'Application' | 'Programme';
  maxDepth: number;
  includePaths: boolean;

  maxTraversalNodes: number;
  maxPathCount: number;
};

const parseArgs = (argv: string[]): Args => {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      map.set(key, 'true');
    } else {
      map.set(key, next);
      i += 1;
    }
  }

  const seed = asInt(map.get('seed'), 1337);

  return {
    seed,

    programmes: asInt(map.get('programmes'), 5),
    capabilities: asInt(map.get('capabilities'), 200),
    capabilityHierarchyDepth: asInt(map.get('capabilityHierarchyDepth'), 4),
    capabilityBranching: asInt(map.get('capabilityBranching'), 3),
    businessProcesses: asInt(map.get('businessProcesses'), 600),
    applications: asInt(map.get('applications'), 800),
    technologies: asInt(map.get('technologies'), 80),

    dependencyFanout: asInt(map.get('dependencyFanout'), 8),
    appChainDepth: asInt(map.get('appChainDepth'), 50),
    programmeImpactsPerProgramme: asInt(map.get('programmeImpactsPerProgramme'), 60),

    runs: asInt(map.get('runs'), 50),
    concurrency: Math.max(1, asInt(map.get('concurrency'), 1)),

    rootKind: (asString(map.get('rootKind'), 'Application') as any) === 'Programme' ? 'Programme' : 'Application',
    maxDepth: Math.max(1, asInt(map.get('maxDepth'), 10)),
    includePaths: asBool(map.get('includePaths'), false),

    maxTraversalNodes: Math.max(1, asInt(map.get('maxTraversalNodes'), 25_000)),
    maxPathCount: Math.max(1, asInt(map.get('maxPathCount'), 250_000)),
  };
};

const percentile = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
};

const memSnapshot = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mu = (process as any).memoryUsage?.();
  if (!mu) return null;
  return {
    rss: mu.rss,
    heapUsed: mu.heapUsed,
    heapTotal: mu.heapTotal,
    external: mu.external,
    arrayBuffers: mu.arrayBuffers,
  };
};

const buildRequest = (args: Args, runIndex: number, rootId: string, rootType: Args['rootKind']): ImpactAnalysisRequest => {
  const includedRelationshipTypes =
    rootType === 'Programme'
      ? ['IMPACTS', 'DECOMPOSES_TO', 'SERVED_BY', 'INTEGRATES_WITH', 'DEPLOYED_ON']
      : ['INTEGRATES_WITH'];

  return {
    requestId: `loadtest|${args.seed}|${runIndex}|${rootId}`,
    projectId: 'loadtest',
    requestedBy: 'loadtest',
    requestedAt: new Date().toISOString(),

    rootElementId: rootId,
    rootElementType: rootType,
    direction: 'Downstream',
    maxDepth: args.maxDepth,

    includedElementTypes: [],
    includedRelationshipTypes,

    analysisIntent: 'Change',
  };
};

async function runOne(engine: ImpactAnalysisEngine, args: Args, runIndex: number, rootId: string, rootType: Args['rootKind']) {
  const started = nowMs();
  const memBefore = memSnapshot();

  try {
    const request = buildRequest(args, runIndex, rootId, rootType);
    const res = await engine.analyze(request, {
      includePaths: args.includePaths,
      safeguards: { maxTraversalNodes: args.maxTraversalNodes, maxPathCount: args.maxPathCount },
    });

    const durationMs = nowMs() - started;
    const memAfter = memSnapshot();

    return {
      ok: true as const,
      durationMs,
      aborted: res.stats.aborted,
      depth: args.maxDepth,
      nodesVisited: res.stats.expandedNodeCount,
      pathsEnumerated: res.stats.enumeratedPathCount,
      warnings: res.warnings,
      memBefore,
      memAfter,
    };
  } catch (err) {
    const durationMs = nowMs() - started;
    return {
      ok: false as const,
      durationMs,
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
      memBefore,
      memAfter: memSnapshot(),
    };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  const dataset = generateSyntheticDataset({
    seed: args.seed,
    programmes: args.programmes,
    capabilities: args.capabilities,
    capabilityHierarchyDepth: args.capabilityHierarchyDepth,
    capabilityBranching: args.capabilityBranching,
    businessProcesses: args.businessProcesses,
    applications: args.applications,
    technologies: args.technologies,
    dependencyFanout: args.dependencyFanout,
    appChainDepth: args.appChainDepth,
    programmeImpactsPerProgramme: args.programmeImpactsPerProgramme,
  });

  const graph = new RepositoryGraphAbstractionLayer({ elements: dataset.repo, relationships: dataset.relRepo });
  const engine = new ImpactAnalysisEngine(graph);

  const rng = new SeededRandom(args.seed ^ 0x9e3779b9);

  const rootPool = args.rootKind === 'Programme' ? dataset.ids.programmes : dataset.ids.applications;
  if (!rootPool.length) throw new Error(`No root candidates for rootKind=${args.rootKind}`);

  const runsTotal = Math.max(1, Math.trunc(args.runs));
  const concurrency = Math.max(1, Math.trunc(args.concurrency));

  const startedAll = nowMs();
  const memStart = memSnapshot();

  const results: Array<Awaited<ReturnType<typeof runOne>>> = [];

  let nextRun = 0;
  const worker = async (workerIndex: number) => {
    while (true) {
      const idx = nextRun;
      nextRun += 1;
      if (idx >= runsTotal) return;

      const rootId = rng.pick(rootPool);
      const out = await runOne(engine, args, idx, rootId, args.rootKind);
      results.push(out);

      // Lightweight per-run structured output.
      // eslint-disable-next-line no-console
      console.info(
        JSON.stringify({
          type: 'ea.loadtest.run',
          workerIndex,
          runIndex: idx,
          rootKind: args.rootKind,
          rootId,
          ...out,
        }),
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

  const durationAllMs = nowMs() - startedAll;
  const memEnd = memSnapshot();

  const okRuns = results.filter((r) => r.ok);
  const failedRuns = results.filter((r) => !r.ok);
  const abortedRuns = okRuns.filter((r) => r.aborted);

  const durations = okRuns.map((r) => r.durationMs).slice().sort((a, b) => a - b);

  const summary = {
    type: 'ea.loadtest.summary',
    generatedAt: new Date().toISOString(),
    args,
    datasetStats: dataset.stats,
    runsTotal,
    ok: okRuns.length,
    failed: failedRuns.length,
    aborted: abortedRuns.length,
    durationAllMs,
    durationMs: {
      min: durations[0] ?? 0,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations[durations.length - 1] ?? 0,
      avg: durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : 0,
    },
    memoryBytes: {
      start: memStart,
      end: memEnd,
    },
    failureModes: failedRuns.slice(0, 10).map((r) => (r.ok ? null : r.errorMessage)).filter(Boolean),
    abortWarningsSample: abortedRuns.slice(0, 5).flatMap((r) => (r.ok ? r.warnings : [])).slice(0, 10),
  };

  // eslint-disable-next-line no-console
  console.info(JSON.stringify(summary));
}

// Allow running via ts-node/register.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ type: 'ea.loadtest.fatal', errorMessage: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
