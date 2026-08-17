# Phase 17 — PostgreSQL 会话持久化

## 目标

将会话状态迁移为 PostgreSQL 优先存储，同时保留 JSON 回退以兼容本地测试与未配置数据库的开发环境。

## 结构

```text
DATABASE_URL 存在
  → StateManager → PostgresStateManager → sessions / messages / usage_logs
DATABASE_URL 缺失
  → StateManager → 原 JSON 文件实现
```

`sessions.trip_plan` 使用 JSONB 保存完整行程；`messages` 与 `usage_logs` 分表，删除会话时由外键级联删除。

## 改动

- `src/db/schema.sql`：数据库 schema 与索引。
- `src/db/pool.js`：`pg` 连接池。
- `src/services/postgresStateManager.js`：会话、消息、行程、用量与统计查询。
- `stateManager`：按 `DATABASE_URL` 选择 PostgreSQL 或 JSON 回退。
- 路由与 `TravelService`：会话读写统一 `await`，API 语义不变。
- Docker Compose：PostgreSQL 16、健康检查、命名卷及 schema 初始化。

## 验证

```bash
cd travel-recomend-backend
node --check src/services/postgresStateManager.js
node --test src/__tests__/stateManager.test.js src/__tests__/refine.test.js src/__tests__/recommendStream.test.js
```

真实输出：3 个测试文件通过，0 失败。

本环境未启动真实 PostgreSQL 容器；Docker Compose 已在 Phase 15 完成配置校验。部署验证命令：

```bash
docker compose up --build
```

## 面试表述

“我将会话元数据、聊天消息和用量拆表，消息按会话与时间建索引；完整行程使用 JSONB 保留灵活结构。业务层只依赖 StateManager 接口，因此 JSON 到 PostgreSQL 的迁移不改变 API 契约。”
