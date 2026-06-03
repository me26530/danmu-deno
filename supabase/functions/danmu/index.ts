import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleDenoRequest } from "./runtime/deno-worker.ts";

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
    "access-control-allow-headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/__health")) {
    return new Response(
      JSON.stringify(
        {
          ok: true,
          pathname: url.pathname,
          deployment: Deno.env.get("DENO_DEPLOYMENT_ID") ?? "",
          region: Deno.env.get("SB_REGION") ?? "",
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders(),
    });
  }

  try {
    const response = await handleDenoRequest(request);
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
  } catch (error) {
    console.error("[supabase index error]", error);

    return new Response(
      JSON.stringify(
        {
          error: "Supabase Function Error",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : "",
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: {
          ...corsHeaders(),
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }
});
