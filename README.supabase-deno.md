# Supabase / Deno 部署说明

已加入 Supabase Edge Functions 和 Deno Deploy 适配。

## Deno Deploy

如果 Deno Console 提示找不到 `/tmp/build/src/main.ts`，本版本已新增：

```text
src/main.ts
main.ts
deno.json -> deploy.entrypoint = "src/main.ts"
```

Deno Deploy 入口请选择：

```text
src/main.ts
```

## Supabase

GitHub Actions 使用 `--use-api`，并通过 `scripts/prepare-supabase-function.sh` 准备函数文件。
