# Phase 15 — Docker 化启动

## 目标

用一条 `docker compose up --build` 启动前端与后端，前端通过 Nginx 代理 `/api`，后端会话数据通过命名卷持久化。

## 文件

- `docker-compose.yml`：backend 健康检查通过后再启动 frontend；浏览器入口为 `http://localhost:5173`。
- `travel-recomend-backend/Dockerfile`：Node 22 Alpine 运行服务。
- `travel-recomend-front/Dockerfile`：构建 Vue 静态文件并用 Nginx 托管。
- `travel-recomend-front/nginx.conf`：SPA 回退与 `/api` 反向代理，SSE 关闭缓冲。

## 运行

```bash
cp travel-recomend-backend/.env.example travel-recomend-backend/.env
# 填写 API Key
docker compose up --build
```

停止并保留数据：`docker compose down`。完全清除容器数据：`docker compose down -v`。

## 验证

已执行 `docker compose config`，Compose 配置解析通过。未在当前阶段执行镜像构建或真实 API 调用，避免下载镜像及产生 API 成本。

## 面试表述

“前端构建与运行时分离：Node 只负责构建，Nginx 提供静态资源和 API/SSE 反代；后端健康检查作为前端启动依赖，会话文件使用命名卷避免容器重建丢失。”
