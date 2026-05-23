# jsDelivr CDN 加速访问服务（jsd-cdn-accelerator）

把常见的 **GitHub / npm / unpkg** 资源链接解析为 **jsDelivr CDN** 资源，并提供多种输出方式（直连/代理/跳转）：

- **直连（同路径，推荐）**：`/gh/...`、`/npm/...`（路径保持一致，适合"把 cdn.jsdelivr.net 换成你的域名"的场景）
- **Proxy（兼容）**：`/cdn?url=...`（服务端代理返回内容，适合图床直链、跨域、统一域名、可控缓存）
- **Redirect（更轻）**：`/r?url=...`（302 跳转到 jsDelivr）

项目提供一个贴纸风格首页，用于输入链接并一键生成可用的加速 URL。

jsDelivr 官网：`https://www.jsdelivr.com/`；其静态文件 CDN 域名主要为 `cdn.jsdelivr.net` / `fastly.jsdelivr.net`。

---

## 功能与特性

- 支持链接识别与转换
  - GitHub：`raw.githubusercontent.com` / `github.com/.../blob/...` / `github.com/.../raw/...`
  - npm：`unpkg.com`
  - jsDelivr CDN：`cdn.jsdelivr.net/gh/...` / `cdn.jsdelivr.net/npm/...`（可直接作为上游）
  - 简写
    - `gh:owner/repo@ref/path/to/file.ext`
    - `npm:pkg@ver/path/to/file.ext`（支持作用域包：`npm:@scope/pkg@ver/path/to/file.ext`）
- 输出方式
  - `/gh/<owner>/<repo>@<ref>/<path>`：同路径直连（服务端代理 jsDelivr 并返回内容；推荐图床/跨域）
  - `/npm/<pkg>@<ver>/<path>`：同路径直连（服务端代理 jsDelivr 并返回内容；推荐图床/跨域）
  - `/cdn?url=...`：代理输出（同样返回内容，适合"只能用 query 参数"的场景）
  - `/r?url=...`：Redirect（302 跳转到 jsDelivr）
  - `/u?url=...`：仅解析，返回 JSON（首页/前端页面使用）
- 安全策略（Proxy）
  - 仅允许代理 jsDelivr 官方域名：`cdn.jsdelivr.net`、`fastly.jsdelivr.net`
  - 默认开启 `Access-Control-Allow-Origin: *`，适合图片/静态资源跨域引用
- 缓存策略（Proxy）
  - 若 URL ref 识别为"稳定版本"（例如 commit sha 或 semver），会返回长期缓存
  - 若为 `main/master/latest` 等不稳定 ref，默认短缓存

---

## 在线使用

部署后，直接访问首页：

- `GET /`：贴纸风格 UI，输入链接即可生成加速 URL（默认生成 `/gh/...`、`/npm/...` 直连）

---

## API 说明

### 0) 直连（同路径，把 jsDelivr CDN 域名 cdn.jsdelivr.net 换成你的域名）

当你把本服务部署到自己的域名后，你可以把原始 jsDelivr URL 的域名 `cdn.jsdelivr.net` 直接替换为你的服务域名，实现"同路径直连"：

- `https://cdn.jsdelivr.net/gh/owner/repo@ref/path/to/file` → `https://your.domain/gh/owner/repo@ref/path/to/file`
- `https://cdn.jsdelivr.net/npm/pkg@ver/path/to/file` → `https://your.domain/npm/pkg@ver/path/to/file`

说明：

- `/gh/...`、`/npm/...` 在本项目中是"同路径 + 服务端代理返回内容"，适合图片直链与跨域加载
- 如果你只想得到原始 jsDelivr URL（不经过你的服务回源），用首页的"原始 jsDelivr URL"模式即可

示例（图片直链）：

```
https://cdn.jsdelivr.net/gh/rcy1314/phototc@main/uPic/1779086421525.png
https://your.domain/gh/rcy1314/phototc@main/uPic/1779086421525.png
```

本地验证（假设服务跑在 `http://localhost:3010`）：

```
http://localhost:3010/gh/rcy1314/phototc@main/uPic/1779086421525.png
```

### 1) 解析接口

`GET /u?url=<你的链接>`

成功（HTTP 200）示例：

```json
{
  "supported": true,
  "input": "https://raw.githubusercontent.com/user/repo/main/a.png",
  "kind": "gh",
  "jsdelivrUrl": "https://cdn.jsdelivr.net/gh/user/repo@main/a.png",
  "stable": false
}
```

失败（HTTP 400）示例：

```json
{
  "supported": false,
  "input": "xxx",
  "reason": "不是合法 URL（或缺少协议），可尝试使用 gh: / npm: 简写"
}
```

### 2) Redirect 输出（轻量）

`GET /r?url=<你的链接>`

- 返回：302
- Location：转换后的 `jsdelivrUrl`

### 3) Proxy 输出（兼容）

`GET /cdn?url=<你的链接>`

- 推荐优先使用同路径直连（`/gh/...`、`/npm/...`）；`/cdn` 适合"只能用 query 参数"的场景。
- 上游：jsDelivr（仅允许官方域名）
- 返回：原始内容流（图片/JS/CSS/字体/其他静态文件）
- 额外 Header（示例）
  - `access-control-allow-origin: *`
  - `cache-control: ...`
  - `x-upstream-url: https://cdn.jsdelivr.net/...`

### 4) 健康检查

`GET /healthz` → `ok`

---

## 支持的输入示例

### GitHub（raw）

输入：

```
https://raw.githubusercontent.com/jsdelivr/jsdelivr/master/README.md
```

解析为：

```
https://cdn.jsdelivr.net/gh/jsdelivr/jsdelivr@master/README.md
```

### GitHub（blob/raw）

输入：

```
https://github.com/user/repo/blob/main/path/to/file.png
```

解析为：

```
https://cdn.jsdelivr.net/gh/user/repo@main/path/to/file.png
```

### npm（unpkg）

输入：

```
https://unpkg.com/normalize.css@8.0.1/normalize.css
```

解析为：

```
https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css
```

### 简写（GitHub）

输入：

```
gh:user/repo@main/assets/a.png
```

### 简写（npm）

输入：

```
npm:normalize.css@8.0.1/normalize.css
```

作用域包示例：

```
npm:@scope/pkg@1.2.3/dist/index.js
```

---

## 本地开发与运行（Node）

### 依赖安装

```bash
npm ci
```

### 开发启动（热更新）

```bash
npm run dev:node
```

默认监听端口：`5011`  
启动入口：`src/node.ts`

### 构建

```bash
npm run build
```

### 生产启动

```bash
npm run build
npm start
```

### 环境变量

- `PORT`：Node 监听端口（默认 `5011`）
- `DB_PATH`：SQLite 数据库路径（默认 `./data/app.db`）。容器环境推荐设置为 `/app/data/app.db` 并挂载 `/app/data` 目录。

### 数据库初始化与迁移

- 本项目使用 SQLite（`better-sqlite3`），不会随镜像发布任何本地数据库文件。
- 首次启动时会自动创建数据库文件并执行建表/迁移（无需手动初始化脚本）。
- 生产环境建议将数据库文件放到持久化卷中（例如挂载到 `/data`）。

---

## Docker 部署（推荐一键）

### 先说清楚端口映射（你遇到的 5011 无法访问就是这里）

本服务容器内默认监听端口来自环境变量 `PORT`（不设置则默认 `5011`）。

- 你用 `-p 5011:5011` 时，容器内默认就是 5011，因此无需额外设置也能访问
- 若你想换成其他端口（例如 7000），需要同时设置 `-e PORT=7000 -p 7000:7000`

### 方式 A：docker compose 一键启动

```bash
docker compose up -d --build
```

访问：

- `http://localhost:${PORT:-5011}/`

说明：

- `PORT` 可在启动时指定，例如：`PORT=5011 docker compose up -d --build`
- 数据默认持久化到 `./data`（会创建 `./data/app.db`，可用于"沿用旧数据"）

停止：

```bash
docker compose down
```

### 方式 B：docker build + docker run

```bash
docker build -t jsd-cdn-accelerator:latest .
docker run --rm \
  -e PORT=5011 \
  -e DB_PATH=/app/data/app.db \
  -p 5011:5011 \
  -v "$(pwd)/data:/app/data" \
  jsd-cdn-accelerator:latest
```

沿用旧数据（已有历史 `app.db`）：

```bash
docker run --rm \
  -e PORT=5011 \
  -e DB_PATH=/app/data/app.db \
  -p 5011:5011 \
  -v "/path/to/old/data:/app/data" \
  jsd-cdn-accelerator:latest
```

### 方式 C：按你的习惯（/app/data）后台运行

推荐按下面这样跑（首次会自动创建并初始化 `/app/data/app.db`；以后复用旧数据直接沿用该目录即可）：

```bash
docker run -d \
  --name jsd-noise \
  -p 5011:5011 \
  -v /opt/jsd:/app/data \
  -e PORT=5011 \
  -e DB_PATH=/app/data/app.db \
  -e TZ=Asia/Shanghai \
  noise233/jsd-noise:latest
```
```

### Docker 镜像发布（buildx 多架构 + 推送）

说明：

- 镜像发布时不要携带本地数据库：确保 `./data`、`*.db` 已被忽略（本项目已在 `.dockerignore` 中处理）。
- `VERSION` 通过 `--build-arg VERSION=...` 注入到镜像 `APP_VERSION` 环境变量（用于标记版本）。

首次使用 buildx（只需一次）：

```bash
docker buildx create --use
docker buildx inspect --bootstrap
```

登录 Docker Hub：

```bash
docker login
```

构建并推送

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg VERSION=v1.5 \
  -t noise233/jsd-noise:v1.5 \
  -t noise233/jsd-noise:latest \
  --push .
```

发布后拉取运行：

```bash
docker pull noise233/jsd-noise:latest
docker run --rm \
  -e PORT=5011 \
  -e DB_PATH=/app/data/app.db \
  -p 5011:5011 \
  -v "$(pwd)/data:/app/data" \
  -e TZ=Asia/Shanghai \
  noise233/jsd-noise:latest
```

```
docker run -d \
  --name jsd-noise \
  -p 5011:5011 \
  -v /opt/jsd:/app/data \
  -e PORT=5011 \
  -e DB_PATH=/app/data/app.db \
  -e TZ=Asia/Shanghai \
  noise233/jsd-noise:latest
```





---

## Vercel 部署（Node.js Runtime）

项目已提供：

- `vercel.json`
- `api/index.ts`（Node.js Function 入口）

### 方式 A：Vercel 控制台部署

1. 将仓库推到 GitHub
2. Vercel Import 项目
3. Framework 可选 "Other"
4. Build Command：`npm run build`（可选）
5. Output Directory：留空
6. Environment Variables：如需持久化数据，建议设置 `DB_PATH=/var/task/data/app.db`
7. 部署完成后，用分配域名访问 `/`

### 方式 B：Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

> 注意：Vercel Functions 默认只有 512MB 临时文件系统，不适合长期存储 SQLite 数据库。生产环境建议使用 Docker/Fly.io 等持久化存储的方案。

---

## Fly.io 部署

项目已提供 `fly.toml`（使用 Dockerfile 构建）。

### 1) 安装 flyctl 并登录

```bash
fly auth login
```

### 2) 首次创建（按需）

```bash
fly launch
```

如已存在 `fly.toml` 且 app 名称已确定，可跳过交互步骤。

### 3) 部署

```bash
fly deploy
```

---

## Zeabur 部署

推荐使用 **Dockerfile** 方式部署（可避免 `better-sqlite3` 等原生依赖在不同环境的编译坑）。

### 1) 从 GitHub 导入

1. 把仓库推到 GitHub
2. 在 Zeabur 控制台新建项目并添加服务（选择 GitHub 仓库）
3. 等待构建与部署完成

### 2) 环境变量（建议）

- `PORT`：通常平台会自动注入（无需手动设置）；如需固定可设为 `5011`
- `DB_PATH`：建议设为 `/app/data/app.db`
- `TZ`：建议 `Asia/Shanghai`

### 3) 持久化数据（强烈建议）

Node 版使用 SQLite，需要把数据库放在持久化卷里，否则重启/重新部署会丢数据。

- 挂载目录：`/app/data`
- `DB_PATH=/app/data/app.db`

### 4) 使用

- 首页：`/`
- 直连：`/gh/...`、`/npm/...`
- 代理：`/cdn?url=...`
- 后台（Node 版）：`/admin`（首次注册的用户自动成为管理员）

---

## Railway 部署

Railway 可以直接识别仓库根目录的 `Dockerfile` 并构建部署。

### 1) 从 GitHub 导入

1. 把仓库推到 GitHub
2. Railway 新建项目 → Deploy from GitHub repo
3. 等待构建与部署完成

### 2) 环境变量（建议）

- `DB_PATH=/app/data/app.db`
- `TZ=Asia/Shanghai`

说明：

- `PORT` 一般由 Railway 自动注入，本服务会自动读取并监听（无需手动设置）

### 3) 持久化数据（强烈建议）

Railway 建议为 SQLite 挂载 Volume（否则重启/重新部署会丢数据）。

- Volume 挂载路径：`/app/data`
- 同时设置：`DB_PATH=/app/data/app.db`

---

## EdgeOne 部署/接入（推荐作为加速与安全层）

EdgeOne 更适合做"站点加速 + WAF/安全防护"，本项目建议把 **Node 版（Docker）** 部署在 Zeabur / Railway / 自有服务器，然后用 EdgeOne 作为前置加速层。

### 1) 部署源站

先完成以下任一部署：

- Zeabur（上文）
- Railway（上文）
- 自建 Docker（上文 Docker 部署）

确保源站可访问（例如：`https://origin.example.com/healthz` 返回 `ok`）。

### 2) EdgeOne 接入

1. 在 EdgeOne 控制台添加站点并接入域名（例如：`cdn.example.com`）
2. 源站（Origin）填写你的源站域名（例如：`origin.example.com`）
3. 开启 HTTPS（自动证书或上传证书）

### 3) 缓存建议（按需）

- 优先遵循源站返回的 `cache-control`
- 如需更激进的加速，可对 `/gh/*`、`/npm/*` 设置更长缓存；对 `@main/@master/@latest` 等不稳定 ref 建议仍保持短缓存

### 4) 真实 IP（重要）

本项目的安全识别依赖客户端真实 IP。若你在 EdgeOne 后面出现 IP 都变成边缘节点 IP，请检查是否已把 `X-Forwarded-For` 等真实 IP 头正确回源。

---

## GitHub / GHCR：发布 Docker 镜像

项目已内置 GitHub Actions 工作流：

- `.github/workflows/docker-publish.yml`

默认行为：

- push `main`：构建并推送 `ghcr.io/<owner>/<repo>:latest`
- push tag `v*`：构建并推送对应 tag

使用步骤：

1. 把仓库推到 GitHub（默认分支为 `main`）
2. 在 GitHub Package 页面查看镜像
3. 拉取运行（示例）：

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run --rm \
  -e PORT=5011 \
  -e DB_PATH=/data/app.db \
  -p 5011:5011 \
  -v "$(pwd)/data:/data" \
  ghcr.io/<owner>/<repo>:latest
```

---

## 注意事项 / 限制

- GitHub Releases 的 `releases/download/...` 链接不支持直接转换为 jsDelivr（jsDelivr 机制限制）。
- Proxy 模式仅代理 jsDelivr 官方域名，避免成为任意代理。
- 若你使用 `main/master/latest` 等不稳定 ref，Proxy 默认短缓存；建议对需要长期缓存的资源使用 commit sha 或版本号。 2026@ [Noise](https://www.noisework.cn/)
