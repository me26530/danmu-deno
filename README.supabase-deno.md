# Supabase / Deno 部署说明

本包已加入 Supabase Edge Functions / Deno 适配。

## 关键点

- GitHub Actions 使用 `--use-api`，避免 CI 环境依赖 Docker socket。
- 部署前会把 Docker/Node runtime 管理模块替换为 Supabase 安全 stub，避免 `/var/run/docker.sock` 和 `Module not found` 错误。
- `runtime/deno-worker.ts` 会把 `/functions/v1/danmu` 前缀归一化给原 `worker.js`。

## 访问示例

```text
https://<project-ref>.supabase.co/functions/v1/danmu/__health
https://<project-ref>.supabase.co/functions/v1/danmu/<TOKEN>/api/v2/search/anime?keyword=生万物
```
