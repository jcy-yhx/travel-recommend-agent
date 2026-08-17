# Phase 18 — 用户身份与会话授权

## 目标

从“持有 sessionId 即可访问”的单用户演示，升级为注册登录后的多用户会话隔离。

## 实现

- PostgreSQL 新增 `users`，`sessions.user_id` 关联用户。
- `/api/auth/register`：用户名校验、bcrypt 12 轮密码哈希、重复用户 409。
- `/api/auth/login`：校验密码后签发 7 天 JWT。
- `requireAuth`：`/api/travel/*` 必须携带 `Authorization: Bearer <token>`。
- PostgreSQL 会话详情、列表和删除均按 `user_id` 过滤。
- 前端新增登录/注册页；路由守卫拦截未登录访问；Axios 与 SSE 自动携带 JWT。
- Docker Compose 配置 `JWT_SECRET`，并兼容已有 PostgreSQL 卷的 `user_id` schema 升级。

## 验证

```text
auth / retry / stateManager 测试：3/3 通过
前端 npm run build：通过
```

## 使用

```bash
docker compose down -v   # 首次升级且不保留旧数据时
docker compose up --build
```

访问 `http://localhost:5173`，注册后登录。生产环境必须在启动前设置强随机 `JWT_SECRET`。

## 边界

本阶段提供基础账号体系；不含刷新 Token、密码找回、邮箱验证或 OAuth。这些属于后续按产品需求扩展的能力。
