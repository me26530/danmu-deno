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

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, HEAD, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, x-client-info, apikey, content-type",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rewriteRequestForDanmu(request: Request): Request {
  const url = new URL(request.url);
  const originalPathname = url.pathname;

  url.pathname =
    url.pathname
      // Supabase 线上外部路径：
      // /functions/v1/danmu/87654321/api/v2/...
      .replace(/^\/functions\/v1\/danmu(?=\/|$)/, "")
      // 兼容部分运行时/反代可能传入：
      // /danmu/87654321/api/v2/...
      .replace(/^\/danmu(?=\/|$)/, "") || "/";

  // 兼容播放器手动搜索可能使用的不同路径
  if (
    url.pathname.includes("/api/v2/search/episodes") ||
    url.pathname.match(/\/api\/v2\/search\/?$/)
  ) {
    url.pathname = url.pathname
      .replace("/api/v2/search/episodes", "/api/v2/search/anime")
      .replace(/\/api\/v2\/search\/?$/, "/api/v2/search/anime");
  }

  // 兼容不同播放器的搜索参数名
  if (url.pathname.includes("/api/v2/search/anime")) {
    const keyword =
      url.searchParams.get("keyword") ||
      url.searchParams.get("anime") ||
      url.searchParams.get("q") ||
      url.searchParams.get("query") ||
      url.searchParams.get("title") ||
      url.searchParams.get("name");

    if (keyword && !url.searchParams.get("keyword")) {
      url.searchParams.set("keyword", keyword);
    }
  }

  console.log(
    "[danmu-deno] rewrite path:",
    originalPathname,
    "=>",
    url.pathname,
    url.search,
  );

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: request.redirect,
  };

  // GET / HEAD 不能带 body，否则部分运行时会报错
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  return new Request(url.toString(), init);
}

function isApiV2Probe(request: Request): boolean {
  const url = new URL(request.url);

  return /^\/[^/]+\/api\/v2\/?$/.test(url.pathname) ||
    /^\/api\/v2\/?$/.test(url.pathname);
}

function probeResponse(method: string): Response | null {
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  if (method === "GET") {
    return new Response(
      JSON.stringify({
        errorCode: 0,
        success: true,
        errorMessage: "",
        message: "danmu api is running",
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  return null;
}

export async function handleDenoRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(),
    });
  }

  const env = getEnv();
  const ctx = createCtx();
  const rewrittenRequest = rewriteRequestForDanmu(request);
  const rewrittenUrl = new URL(rewrittenRequest.url);

  // 调试：不暴露 token 具体值，只看路径和 token 长度
  const originalUrl = new URL(request.url);
  if (originalUrl.searchParams.get("__debug") === "1") {
    return new Response(
      JSON.stringify(
        {
          ok: true,
          originalPathname: originalUrl.pathname,
          rewrittenPathname: rewrittenUrl.pathname,
          rewrittenSearch: rewrittenUrl.search,
          tokenExists: !!env.TOKEN,
          tokenLength: env.TOKEN?.length ?? 0,
          adminTokenExists: !!env.ADMIN_TOKEN,
        },
        null,
        2,
      ),
      {
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  // 兼容播放器 HEAD / GET 探测 /api/v2
  if (isApiV2Probe(rewrittenRequest)) {
    const response = probeResponse(rewrittenRequest.method);
    if (response) {
      return response;
    }
  }

  try {
    const response = await worker.fetch(rewrittenRequest, env, ctx);
    return withCors(response);
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
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
}
