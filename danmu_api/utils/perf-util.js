import { performance } from 'node:perf_hooks';

function cloneEntry(entry) {
  return {
    name: entry.name,
    startMs: entry.startMs,
    endMs: entry.endMs,
    durationMs: entry.durationMs,
    meta: { ...entry.meta },
  };
}

function buildSummary(entries) {
  const names = {};
  for (const entry of entries) {
    if (!names[entry.name]) {
      names[entry.name] = {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      };
    }

    const bucket = names[entry.name];
    const duration = Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    bucket.count += 1;
    bucket.totalMs = Number((bucket.totalMs + duration).toFixed(3));
    bucket.maxMs = Number(Math.max(bucket.maxMs, duration).toFixed(3));
  }

  return {
    count: entries.length,
    names,
  };
}

export function createPerfCollector(enabled = false) {
  const entries = [];

  return {
    enabled: Boolean(enabled),
    entries,

    start(name, meta = {}) {
      if (!this.enabled) return null;
      const startMs = performance.now();
      const entry = {
        name: String(name || 'unnamed'),
        startMs: Number(startMs.toFixed(3)),
        endMs: null,
        durationMs: null,
        meta: { ...meta },
      };
      entries.push(entry);
      return entry;
    },

    end(token, meta = {}) {
      if (!this.enabled || !token) return null;
      const endMs = performance.now();
      token.endMs = Number(endMs.toFixed(3));
      token.durationMs = Number((endMs - token.startMs).toFixed(3));
      token.meta = { ...token.meta, ...meta };
      return cloneEntry(token);
    },

    async wrap(name, fn, meta = {}) {
      const token = this.start(name, meta);
      try {
        return await fn();
      } finally {
        this.end(token);
      }
    },

    snapshot() {
      return entries.map(cloneEntry);
    },

    summary() {
      return buildSummary(entries);
    },
  };
}
