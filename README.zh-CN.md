# AI Site Detection

[English](./README.md)

检测 API 网关是否支持 OpenAI、Anthropic 或 Gemini 兼容接口 —— 通过发送真实 HTTP 请求进行探测。

## 功能特性

- **多 Provider 检测** — 支持 OpenAI Chat、OpenAI Codex (Responses API)、Anthropic、Gemini
- **单 Provider 重新检测** — 支持单独重新检测某个 Provider，无需全部重跑
- **置信度评分** — 基于模型列表 + 端点探测结果，返回 High / Medium / Low
- **请求追踪** — 每次探测的完整 HTTP 记录（请求头、请求体、响应体，敏感信息已脱敏）
- **智能粘贴** — 粘贴包含 URL 和 API Key 的文本，自动提取两个字段
- **两种部署模式** — 前后端分离（Vue + Fastify）或单文件 Cloudflare Worker

## 项目结构

```
├── shared/          # 共享 TypeScript 类型（DetectRequest, ProviderDetectionResult 等）
├── server/          # Fastify API 服务端（TypeScript）
│   └── src/
│       ├── providers/   # OpenAI / Anthropic / Gemini 检测器实现
│       ├── services/    # detectAll / detectOne 编排函数
│       └── routes/      # POST /api/detect, POST /api/detect-one
├── web/             # Vue 3 + Vite 前端
│   └── src/
│       ├── api/         # API 客户端（detectSite, detectOne）
│       └── components/  # DetectForm, ProviderCard, ResultSummary, RequestTraceDrawer
└── worker/          # Cloudflare Worker（单文件，自包含）
    └── worker.js
```

## 快速开始

### 前后端分离模式（Vue + Fastify）

```bash
# 安装依赖
npm install

# 同时启动前端和后端（开发模式）
make dev

# 或者分别启动
make web     # 仅前端（Vite 开发服务器，端口 5173）
make server  # 仅后端（Fastify，端口 3000）
```

### Cloudflare Worker 模式

```bash
cd worker
npm install
npx wrangler dev worker.js
```

### Docker 部署

```bash
# 构建并启动
cd deploy
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

访问地址: http://localhost:3000

**自定义端口：** 编辑 `deploy/docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # 将主机 8080 端口映射到容器 3000 端口
```

**环境变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 服务地址 |
| `NODE_ENV` | `production` | Node 环境 |

## API 接口

### `POST /api/detect`

对所有 Provider 执行全量检测。

**请求体：**

```json
{
  "baseUrl": "https://api.example.com",
  "apiKey": "sk-...",
  "timeoutMs": 8000
}
```

**响应体：**

```json
{
  "ok": true,
  "normalizedBaseUrl": "https://api.example.com",
  "startedAt": "...",
  "finishedAt": "...",
  "results": [
    {
      "provider": "openai-chat",
      "supported": true,
      "confidence": "high",
      "models": ["gpt-4o-mini", "..."],
      "endpointTried": "https://api.example.com/v1/chat/completions",
      "statusCode": 200,
      "latencyMs": 342,
      "traces": [...]
    }
  ]
}
```

### `POST /api/detect-one`

重新检测单个 Provider。

**请求体：**

```json
{
  "baseUrl": "https://api.example.com",
  "apiKey": "sk-...",
  "provider": "anthropic",
  "timeoutMs": 8000
}
```

**响应体：** 单个 `ProviderDetectionResult` 对象（与上面 `results` 数组中的元素结构相同）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `make dev` | 同时启动前端和后端 |
| `make web` | 启动前端开发服务器 |
| `make server` | 启动后端开发服务器 |
| `make build` | 构建前端和后端 |
| `make test` | 运行所有测试 |

## 技术栈

- **前端:** Vue 3 + TypeScript + Vite
- **后端:** Fastify + TypeScript
- **Worker:** Cloudflare Workers (原生 JS)
- **测试:** Vitest

## License

MIT
