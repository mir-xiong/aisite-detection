# AI Site Detection — Cloudflare Worker

自包含的 Cloudflare Worker，包含完整的 AI 网关检测后端 + 内嵌前端 UI。

## 功能

- 检测目标 URL 是否支持 **OpenAI**（Chat Completions / Responses API）、**Anthropic**、**Gemini** 兼容接口
- 并行探测三大 provider，返回模型列表、置信度、请求 trace 等详细信息
- 单文件部署，无需构建步骤

## 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 返回内嵌的 HTML 单页应用 |
| `POST` | `/api/detect` | 执行检测，返回 JSON |

## 部署

### 方式一：Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create**
3. 选择 **Create Worker**
4. 将 `worker.js` 的全部内容粘贴到编辑器中
5. 点击 **Deploy**

### 方式二：Wrangler CLI

1. 安装 wrangler：

```bash
npm install -g wrangler
```

2. 在 `worker/` 目录下创建 `wrangler.toml`：

```toml
name = "ai-site-detection"
main = "worker.js"
compatibility_date = "2024-01-01"
```

3. 本地开发：

```bash
npx wrangler dev worker.js
```

4. 部署到 Cloudflare：

```bash
npx wrangler deploy
```

## 使用

访问 Worker URL（本地开发默认 `http://localhost:8787`），在页面中：

1. 输入目标 API 的 **Base URL** 和 **API Key**
2. 可选调整 **Timeout**
3. 点击 **Detect** 开始检测
4. 查看各 provider 的检测结果，点击 **View trace** 查看请求详情

**Smart Paste**：可以直接粘贴包含 URL 和 API Key 的文本，点击 Extract 自动解析填充。

## API 接口

### `POST /api/detect`

**Request Body:**

```json
{
  "baseUrl": "https://api.example.com",
  "apiKey": "sk-xxx",
  "timeoutMs": 8000
}
```

**Response:**

```json
{
  "ok": true,
  "normalizedBaseUrl": "https://api.example.com",
  "startedAt": "2024-01-01T00:00:00.000Z",
  "finishedAt": "2024-01-01T00:00:05.000Z",
  "results": [
    {
      "provider": "openai-chat",
      "supported": true,
      "confidence": "high",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "endpointTried": "https://api.example.com/v1/chat/completions",
      "statusCode": 200,
      "latencyMs": 1234,
      "traces": [...]
    }
  ]
}
```

## 自定义

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `timeoutMs` | `8000` | 每个 HTTP 探测的超时时间（毫秒） |

如需修改默认模型或探测路径，直接编辑 `worker.js` 中对应的常量即可。
