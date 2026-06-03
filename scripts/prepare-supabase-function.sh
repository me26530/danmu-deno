#!/usr/bin/env bash
set -euo pipefail

echo "Preparing files for Supabase Edge Function..."
mkdir -p supabase/functions/danmu/runtime
cp runtime/deno-worker.ts supabase/functions/danmu/runtime/deno-worker.ts
cp deno.json supabase/functions/danmu/deno.json
cp package.json supabase/functions/danmu/package.json
rm -rf supabase/functions/danmu/danmu_api
cp -r danmu_api supabase/functions/danmu/danmu_api
find supabase/functions/danmu/danmu_api -name "*.test.js" -type f -delete

if [ -d supabase/functions/danmu/danmu_api/runtime ]; then
cat > supabase/functions/danmu/danmu_api/runtime/runtime-handler-factory.js <<'JS'
export async function createRuntimeHandler(globals, deployPlatform) {
  const { CloudRuntimeHandler } = await import('./cloud-runtime-handler.js');
  return new CloudRuntimeHandler(globals, deployPlatform || 'supabase');
}
JS
cat > supabase/functions/danmu/danmu_api/runtime/docker-runtime-handler.js <<'JS'
export class DockerRuntimeHandler { constructor() { throw new Error('Docker runtime is disabled on Supabase Edge Functions'); } }
JS
cat > supabase/functions/danmu/danmu_api/runtime/docker-engine-client.js <<'JS'
export function createDockerEngineClient() { throw new Error('Docker engine client is disabled on Supabase Edge Functions'); }
JS
cat > supabase/functions/danmu/danmu_api/runtime/docker-image-ref.js <<'JS'
export function parseDockerImageReference(imageRef) { const value = String(imageRef || ''); return { original: value, registry: '', repository: value, tag: '', digest: '', normalized: value }; }
export function resolveDockerVersionLookupImage(configuredImageRef = '', runningImageRef = '', defaultRepository = 'lilixu3/danmu-api') { return String(configuredImageRef || runningImageRef || defaultRepository || ''); }
export function resolveDockerRuntimeImageTargets({ configuredImageRef = '', runningImageRef = '', defaultRepository = 'lilixu3/danmu-api' } = {}) { const image = resolveDockerVersionLookupImage(configuredImageRef, runningImageRef, defaultRepository); return { configuredImageRef: String(configuredImageRef || ''), runningImageRef: String(runningImageRef || ''), lookupImageRef: image, updateImageRef: image }; }
JS
cat > supabase/functions/danmu/danmu_api/runtime/runtime-state.js <<'JS'
const state = { latestVersion: '', latestVersionCheckedAt: '', latestVersionError: '', update: { running: false, state: 'idle', message: '', targetVersion: '', logs: [] } };
export function getRuntimeState() { return state; }
export function recordLatestVersion(latestVersion, checkedAt = new Date(), error = '') { state.latestVersion = latestVersion || ''; state.latestVersionCheckedAt = checkedAt instanceof Date ? checkedAt.toISOString() : String(checkedAt || ''); state.latestVersionError = error || ''; return state; }
export function startRuntimeUpdate(message, targetVersion = '') { state.update = { running: false, state: 'disabled', message: message || 'Runtime update is disabled on Supabase Edge Functions', targetVersion, logs: [] }; return state.update; }
export function setRuntimeUpdateState(nextState, message = '', targetVersion = '') { state.update = { ...state.update, running: false, state: nextState || 'disabled', message, targetVersion }; return state.update; }
export function pushRuntimeUpdateLog(message) { state.update.logs.push(String(message || '')); return state.update; }
export function setRuntimeUpdateHelperContainer() { return state.update; }
export function finishRuntimeUpdate(success, message, targetVersion = '') { state.update = { ...state.update, running: false, state: success ? 'success' : 'failed', message: message || '', targetVersion }; return state.update; }
JS
cat > supabase/functions/danmu/danmu_api/runtime/node-runtime-handler.js <<'JS'
export class NodeRuntimeHandler { constructor() { throw new Error('Node runtime is disabled on Supabase Edge Functions'); } }
JS
cat > supabase/functions/danmu/danmu_api/runtime/json-file-cache.js <<'JS'
export function resolveCacheFilePathFromModuleUrl(moduleUrl, cacheKey, overridePath = '') { return String(overridePath || cacheKey || moduleUrl || ''); }
export function readJsonFileCache() { return null; }
export function writeJsonFileCache() { return false; }
JS
fi

if [ -d config ]; then rm -rf supabase/functions/danmu/config; cp -r config supabase/functions/danmu/config; fi

echo "Checking required files..."
test -f supabase/functions/danmu/index.ts
test -f supabase/functions/danmu/runtime/deno-worker.ts
test -f supabase/functions/danmu/danmu_api/worker.js
test -f supabase/functions/danmu/danmu_api/runtime/docker-image-ref.js
test -f supabase/functions/danmu/danmu_api/runtime/runtime-state.js
test -f supabase/functions/danmu/deno.json
test -f supabase/functions/danmu/package.json
find supabase/functions/danmu -maxdepth 4 -type f | sort
