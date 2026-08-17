# Phase 16 — 基础安全边界

## 目标

在不引入登录系统的前提下，收紧浏览器来源、请求体和直接进入 Agent prompt 的用户输入。

## 改动

- `src/index.js`：CORS 改为 `ALLOWED_ORIGINS` 白名单；默认只允许本地前端两个地址。JSON 与表单 body 最大 16KB。
- `src/routes/travel.js`：城市必须是 2–30 位中英文城市名；修改指令最多 200 字；聊天消息最多 1000 字。
- `.env.example`：增加 `ALLOWED_ORIGINS` 配置说明。

这些校验位于 HTTP 边界，非法数据不会进入 `TravelService` 或被拼入 prompt。

## 运行配置

```env
ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
```

部署时应替换为真实前端域名；多个域名用英文逗号分隔。

## 验证

```bash
node --check src/index.js
node --check src/routes/travel.js
node --test src/__tests__/hardening.test.js
```

真实结果：`hardening.test.js` 通过。`smoke.test.js` 需要监听本地端口，在当前受限沙箱中会因 `EPERM` 启动失败，未将其伪报为代码失败。

## 边界

本阶段不做鉴权：会话 ID 仍不是用户身份。下一步若需要多用户或公开部署，应先引入认证与会话归属校验。
