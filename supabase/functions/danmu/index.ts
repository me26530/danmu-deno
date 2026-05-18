import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleDenoRequest } from "../../../runtime/deno-worker.ts";

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

function rewriteRequestForDanmu(req: Request): Request {
  const url = new URL(req.url);
  const originalPath = url.pathname;

  url.pathname =
    url.pathname
      .replace(/^\/functions\/v1\/danmu(?=\/|$)/, "")
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
    "rewrite path:",
    originalPath,
    "=>",
    url.pathname,
    url.search,
  );

  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    redirect: req.redirect,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  return new Request(url.toString(), init);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 健康检查，不进入业务逻辑
  if (url.pathname.endsWith("/__health")) {
    return new Response(
      JSON.stringify({
        ok: true,
        pathname: url.pathname,
        deployment: Deno.env.get("DENO_DEPLOYMENT_ID") ?? "",
        region: Deno.env.get("SB_REGION") ?? "",
      }),
      {
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(),
    });
  }

  const rewrittenReq = rewriteRequestForDanmu(req);
  const rewrittenUrl = new URL(rewrittenReq.url);

  // debug：确认路径是否改对
  if (url.searchParams.get("__debug") === "1") {
    const token = Deno.env.get("TOKEN") ?? "";
    return new Response(
      JSON.stringify(
        {
          ok: true,
          originalPathname: url.pathname,
          rewrittenPathname: rewrittenUrl.pathname,
          rewrittenSearch: rewrittenUrl.search,
          tokenExists: !!token,
          tokenLength: token.length,
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

  // 兼容播放器 HEAD 探测 /api/v2
  if (
    rewrittenReq.method === "HEAD" &&
    (
      /^\/[^/]+\/api\/v2\/?$/.test(rewrittenUrl.pathname) ||
      /^\/api\/v2\/?$/.test(rewrittenUrl.pathname)
    )
  ) {
    return new Response(null, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  // 兼容播放器 GET 探测 /api/v2
  if (
    rewrittenReq.method === "GET" &&
    (
      /^\/[^/]+\/api\/v2\/?$/.test(rewrittenUrl.pathname) ||
      /^\/api\/v2\/?$/.test(rewrittenUrl.pathname)
    )
  ) {
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

  const response = await handleDenoRequest(rewrittenReq);
  return withCors(response);
});
