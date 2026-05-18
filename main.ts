import worker from "./danmu_api/worker.js";

const port = Number(
  Deno.env.get("DANMU_API_PORT") ??
    Deno.env.get("PORT") ??
    "9321",
);

function getEnv(): Record<string, string> {
  const env = Deno.env.toObject();

  if (!env.TOKEN) {
    env.TOKEN = "87654321";
  }

  if (!env.ADMIN_TOKEN) {
    env.ADMIN_TOKEN = "";
  }

  return env;
}

console.log(`Danmu API Deno server listening on http://0.0.0.0:${port}`);

Deno.serve({ port }, async (request: Request) => {
  const env = getEnv();

  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      promise.catch((error) => {
        console.error("[waitUntil error]", error);
      });
    },
  };

  try {
    return await worker.fetch(request, env, ctx);
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
});
