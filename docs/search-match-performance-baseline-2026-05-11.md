# Phase 0 standalone baseline report

Generated: 2026-05-11T08:48:57.508Z  
Node: v24.14.1  
Command: `node scripts/search-match-performance-baseline.mjs`  
Mode: synthetic in-memory candidates; no real source network access; no persistent cache writes.

## Config

- sizes: 25, 100, 500
- linksPerAnime: 12
- sourceCount: 5
- mergeMaxSize: 25

## Results

### size=25

- detail-fanout:unbounded-Promise.all
  - elapsedMs: 1.415
  - candidates: 25
  - detailRequests: 25
  - maxConcurrent: 25
- source-handle:serial-sources+unbounded-source-detail
  - elapsedMs: 2.343
  - candidatesPerSource: 25
  - sources: 5
  - detailRequests: 125
  - maxConcurrent: 25
- cache-write:addAnime+addEpisode
  - elapsedMs: 280.844
  - candidates: 25
  - storedAnimes: 25
  - storedEpisodes: 300
  - detailStoreEntries: 50
- search-cache:set+get
  - elapsedMs: 1.94
  - cacheHit: true
  - cachedResults: 25
- merge:applyMergeLogic
  - elapsedMs: 566.944
  - candidatePairs: 25
  - inputAnimes: 50
  - outputAnimes: 25
  - detailStoreEntries: 102

### size=100

- detail-fanout:unbounded-Promise.all
  - elapsedMs: 0.999
  - candidates: 100
  - detailRequests: 100
  - maxConcurrent: 100
- source-handle:serial-sources+unbounded-source-detail
  - elapsedMs: 4.708
  - candidatesPerSource: 100
  - sources: 5
  - detailRequests: 500
  - maxConcurrent: 100
- cache-write:addAnime+addEpisode
  - elapsedMs: 3960.869
  - candidates: 100
  - storedAnimes: 100
  - storedEpisodes: 1200
  - detailStoreEntries: 200
- search-cache:set+get
  - elapsedMs: 0.865
  - cacheHit: true
  - cachedResults: 100
- merge:applyMergeLogic
  - skipped by default
  - reason: `size>25`; run with `--merge-max=100` for explicit stress test

### size=500

- detail-fanout:unbounded-Promise.all
  - elapsedMs: 7.745
  - candidates: 500
  - detailRequests: 500
  - maxConcurrent: 500
- source-handle:serial-sources+unbounded-source-detail
  - elapsedMs: 27.481
  - candidatesPerSource: 500
  - sources: 5
  - detailRequests: 2500
  - maxConcurrent: 500
- cache-write:addAnime+addEpisode
  - elapsedMs: 104737.118
  - candidates: 500
  - storedAnimes: 500
  - storedEpisodes: 6000
  - detailStoreEntries: 1000
- search-cache:set+get
  - elapsedMs: 5.776
  - cacheHit: true
  - cachedResults: 500
- merge:applyMergeLogic
  - skipped by default
  - reason: `size>25`; run with `--merge-max=500` for explicit stress test

## Interpretation

- `addAnime + addEpisode` is the most obvious synthetic in-memory hotspot: 100 candidates x 12 links is ~3.96s; 500 candidates x 12 links is ~104.7s.
- This supports Phase 4/6 priorities: avoid eager detail/cache writes for manual search and add cache-side indexes.
- `applyMergeLogic` is already ~567ms for only 25 pairs; explicit 500-pair stress previously exceeded the 600s command timeout. This supports Phase 5 indexing and cautious merge benchmarking.
- Unbounded detail fanout shows max concurrency equals candidates per source; this supports Phase 7 concurrency limiting.
