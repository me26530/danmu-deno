# Supabase / Deno 部署说明

本包已加入 Supabase Edge Functions / Deno 适配。

## 本版修复点

- Workflow 保持简单，不再把大量 `cat` / `printf` 写在 YAML 中，避免 GitHub 手机网页编辑器导致 YAML 不能运行。
- 复杂准备逻辑移动到 `scripts/prepare-supabase-function.sh`。
- 部署使用 `--use-api`，避免 GitHub Actions 依赖 Docker socket。
- Docker/Node runtime 管理模块会在部署前替换为 Supabase 安全 stub，避免 `/var/run/docker.sock` 和 `Module not found docker-image-ref.js`。

## 访问示例

```text
https://<project-ref>.supabase.co/functions/v1/danmu/__health
https://<project-ref>.supabase.co/functions/v1/danmu/<TOKEN>/api/v2/search/anime?keyword=生万物
```
