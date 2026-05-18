import worker from "../danmu_api/worker.js";

export function getEnv(): Record<string, string> {
  const env = Deno.env.toObject();

  if (!env.TOKEN) {
    env.TOKEN = "87654321";
  }

  if (!env.ADMIN_TOKEN) {
    env.ADMIN_TOKEN = "";
  }

  return env;
}

export function createCtx() {
  return {
    waitUntil(promise: Promise<unknown>) {
      const edgeRuntime = (globalThis as unknown as {
        EdgeRuntime?: {
          waitUntil?: (promise: Promise<unknown>) => void;
        };
      }).EdgeRuntime;

      if (edgeRuntime?.waitUntil) {
        edgeRuntime.waitUntil(promise);
      } else {
        promise.catch((error) => {
          console.error("[waitUntil error]", error);
        });
      }
    },
  };
}

function normalizeRequestForRuntime(request: Request): Request {
  const url = new URL(request.url);

  url.pathname = url.pathname
    .replace(/^\/functions\/v1\/danmu(?=\/|$)/, "")
    .replace(/^\/danmu(?=\/|$)/, "");

  if (!url.pathname) {
    url.pathname = "/";
  }

  return new Request(url.toString(), request);
}

export async function handleDenoRequest(request: Request): Promise<Response> {
  const env = getEnv();
  const ctx = createCtx();
  const normalizedRequest = normalizeRequestForRuntime(request);

  try {
    return await worker.fetch(normalizedRequest, env, ctx);
  } catch (error) {
    console.error("[worker.fetch error]", error);

    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
}
