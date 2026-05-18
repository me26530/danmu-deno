import { handleDenoRequest } from "../../../runtime/deno-worker.ts";

Deno.serve(handleDenoRequest);
