# Supabase / Deno 部署说明

本包已加入 Supabase Edge Functions / Deno 适配：

- `runtime/deno-worker.ts`：Deno/Supabase 请求适配层
- `supabase/functions/danmu/index.ts`：Supabase Edge Function 入口
- `supabase/config.toml`：关闭 JWT 校验，允许播放器直接访问
- `.github/workflows/deploy-supabase.yml`：GitHub Actions 自动部署
- `deno.json`：Deno/npm/node 兼容导入映射

## GitHub Actions 自动部署

在 GitHub 仓库 Settings -> Secrets and variables -> Actions 中添加：

```text
SUPABASE_ACCESS_TOKEN=你的 Supabase access token
SUPABASE_PROJECT_IDS=你的 project ref，多个用空格分隔
```

推送到 `main` 或手动运行 `Deploy Supabase Edge Function` workflow 即可部署。

## 手动部署

```bash
supabase login
supabase functions deploy danmu --project-ref <your-project-ref> --no-verify-jwt --debug
```

## 设置运行环境变量

```bash
supabase secrets set TOKEN=87654321 --project-ref <your-project-ref>
supabase secrets set ADMIN_TOKEN=your-admin-token --project-ref <your-project-ref>
```

## 访问示例

健康检查：

```text
https://<project-ref>.supabase.co/functions/v1/danmu/__health
```

搜索接口：

```text
https://<project-ref>.supabase.co/functions/v1/danmu/87654321/api/v2/search/anime?keyword=生万物
```

调试路径归一化：

```text
https://<project-ref>.supabase.co/functions/v1/danmu/87654321/api/v2/search/anime?keyword=test&__debug=1
```
