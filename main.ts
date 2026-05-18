import { handleDenoRequest } from "./runtime/deno-worker.ts";

const port = Number(
  Deno.env.get("DANMU_API_PORT") ??
    Deno.env.get("PORT") ??
    "9321",
);

console.log(`Danmu API Deno server listening on http://0.0.0.0:${port}`);

Deno.serve({ port }, handleDenoRequest);
