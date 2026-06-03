# Supabase / Deno 部署说明

本包已加入 Supabase Edge Functions / Deno 适配。

重要：GitHub Actions 使用 `--use-api`，并在部署前移除 Docker/Node runtime 管理模块，避免 Supabase 打包阶段访问 `/var/run/docker.sock`。

访问：

```text
https://<project-ref>.supabase.co/functions/v1/danmu/__health
https://<project-ref>.supabase.co/functions/v1/danmu/<TOKEN>/api/v2/search/anime?keyword=生万物
```
