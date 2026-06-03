export async function mapWithConcurrency(items, concurrency, mapper, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const limit = normalizeConcurrency(concurrency, 1, Number.MAX_SAFE_INTEGER);
  const settle = options?.settle === true;
  const results = new Array(items.length);
  let nextIndex = 0;
  let active = 0;
  let completed = 0;
  let rejected = false;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (!settle && rejected) {
        return;
      }

      if (completed === items.length) {
        resolve(results);
        return;
      }

      while (active < limit && nextIndex < items.length && (settle || !rejected)) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        active += 1;

        Promise.resolve()
          .then(() => mapper(items[currentIndex], currentIndex, items))
          .then((value) => {
            results[currentIndex] = settle ? { status: 'fulfilled', value } : value;
          })
          .catch((reason) => {
            if (settle) {
              results[currentIndex] = { status: 'rejected', reason };
              return;
            }
            rejected = true;
            reject(reason);
          })
          .finally(() => {
            active -= 1;
            completed += 1;
            launchNext();
          });
      }
    };

    launchNext();
  });
}

export function normalizeConcurrency(value, fallback = 4, max = 16) {
  const parsed = Math.floor(Number(value));
  const normalizedFallback = Math.max(1, Math.floor(Number(fallback) || 1));
  const normalizedMax = Math.max(1, Math.floor(Number(max) || normalizedFallback));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(normalizedFallback, normalizedMax);
  }
  return Math.min(parsed, normalizedMax);
}

export function resolveSourceConcurrency(sourceName, config = {}) {
  const perSource = config?.sourceDetailConcurrencyBySource || {};
  const sourceValue = sourceName ? perSource[sourceName] : undefined;
  const fallback = normalizeConcurrency(config?.sourceDetailConcurrency, 4, 16);
  return normalizeConcurrency(sourceValue, fallback, 16);
}
