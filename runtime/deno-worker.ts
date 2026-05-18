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

function isSupabaseFunctionRequest(request: Request): boolean {
  const url = new URL(request.url);

  return (
    /^\/functions\/v1\/danmu(?=\/|$)/.test(url.pathname) ||
    /^\/danmu(?=\/|$)/.test(url.pathname)
  );
}

function getTokenFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts[0] === "api") {
    return "";
  }

  return parts[0];
}

function rewriteUrlString(
  value: string,
  originalRequest: Request,
  normalizedRequest: Request,
): string {
  const originalUrl = new URL(originalRequest.url);
  const normalizedUrl = new URL(normalizedRequest.url);
  const token = getTokenFromPath(normalizedUrl.pathname);

  if (!token) {
    return value;
  }

  try {
    const target = new URL(value);

    // 只改当前 Supabase host 生成出来的 URL，避免误伤外部视频/图片地址
    if (target.hostname !== originalUrl.hostname) {
      return value;
    }

    // worker 生成的是 /{TOKEN}/api/v2/comment/...
    // Supabase 外部真实路径需要 /functions/v1/danmu/{TOKEN}/api/v2/comment/...
    const tokenPrefix = `/${token}`;

    if (target.pathname === tokenPrefix || target.pathname.startsWith(tokenPrefix + "/")) {
      target.protocol = "https:";
      target.pathname = `/functions/v1/danmu${target.pathname}`;
      return target.toString();
    }

    return value;
  } catch {
    return value;
  }
}

function rewriteJsonUrls(
  value: unknown,
  originalRequest: Request,
  normalizedRequest: Request,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonUrls(item, originalRequest, normalizedRequest));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && (key === "url" || item.startsWith("http://") || item.startsWith("https://"))) {
        result[key] = rewriteUrlString(item, originalRequest, normalizedRequest);
      } else {
        result[key] = rewriteJsonUrls(item, originalRequest, normalizedRequest);
      }
    }

    return result;
  }

  return value;
}

async function rewriteSupabaseResponseUrls(
  response: Response,
  originalRequest: Request,
  normalizedRequest: Request,
): Promise<Response> {
  if (!isSupabaseFunctionRequest(originalRequest)) {
    return response;
  }

  const contentType = response.headers.get("content-type") || "";

  // FongMi 返回是 JSON。这里仅处理 JSON，XML 弹幕不动。
  if (!contentType.includes("json")) {
    return response;
  }

  const text = await response.clone().text();

  if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
    return response;
  }

  try {
    const data = JSON.parse(text);
    const rewritten = rewriteJsonUrls(data, originalRequest, normalizedRequest);
    const headers = new Headers(response.headers);

    headers.delete("content-length");
    headers.set("content-type", "application/json; charset=utf-8");

    return new Response(JSON.stringify(rewritten), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export async function handleDenoRequest(request: Request): Promise<Response> {
  const env = getEnv();
  const ctx = createCtx();
  const normalizedRequest = normalizeRequestForRuntime(request);

  const originalUrl = new URL(request.url);
  const normalizedUrl = new URL(normalizedRequest.url);

  if (originalUrl.searchParams.get("__debug") === "1") {
    return new Response(
      JSON.stringify(
        {
          ok: true,
          originalPathname: originalUrl.pathname,
          normalizedPathname: normalizedUrl.pathname,
          originalSearch: originalUrl.search,
          normalizedSearch: normalizedUrl.search,
          tokenExists: !!env.TOKEN,
          tokenLength: env.TOKEN?.length ?? 0,
          adminTokenExists: !!env.ADMIN_TOKEN,
        },
        null,
        2,
      ),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      },
    );
  }

  try {
    const response = await worker.fetch(normalizedRequest, env, ctx);

    return await rewriteSupabaseResponseUrls(
      response,
      request,
      normalizedRequest,
    );
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
          "access-control-allow-origin": "*",
        },
      },
    );
  }
}
