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

function isSupabaseHost(hostname: string): boolean {
  return hostname.endsWith(".supabase.co");
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

  // token 以 normalized path 为准：
  // /1105074071/api/v2/...
  const token = getTokenFromPath(normalizedUrl.pathname);

  if (!token) {
    return value;
  }

  try {
    const target = new URL(value);

    // 只处理当前 Supabase host 生成的内部 API URL，不碰外部视频/图片地址
    if (target.hostname !== originalUrl.hostname) {
      return value;
    }

    // 只在 Supabase host 下重写，避免影响普通 Deno 本地运行
    if (!isSupabaseHost(originalUrl.hostname)) {
      return value;
    }

    // 已经是正确 Supabase Function 路径就不重复处理
    if (target.pathname.startsWith("/functions/v1/danmu/")) {
      target.protocol = "https:";
      return target.toString();
    }

    const tokenPrefix = `/${token}`;

    // worker 生成的是：
    // /1105074071/api/v2/comment/...
    //
    // Supabase 外部需要：
    // /functions/v1/danmu/1105074071/api/v2/comment/...
    if (
      target.pathname === tokenPrefix ||
      target.pathname.startsWith(tokenPrefix + "/")
    ) {
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
    return value.map((item) =>
      rewriteJsonUrls(item, originalRequest, normalizedRequest)
    );
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof item === "string" &&
        (
          key === "url" ||
          item.startsWith("http://") ||
          item.startsWith("https://")
        )
      ) {
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
  const originalUrl = new URL(originalRequest.url);

  // 只在 Supabase host 下尝试重写
  if (!isSupabaseHost(originalUrl.hostname)) {
    return response;
  }

  const text = await response.clone().text();
  const trimmed = text.trim();

  // 不依赖 content-type；只要 body 像 JSON，就尝试处理
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return response;
  }

  try {
    const data = JSON.parse(text);
    const rewritten = rewriteJsonUrls(data, originalRequest, normalizedRequest);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("access-control-allow-origin", "*");

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
          originalHost: originalUrl.hostname,
          isSupabaseHost: isSupabaseHost(originalUrl.hostname),
          tokenFromNormalizedPath: getTokenFromPath(normalizedUrl.pathname),
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
