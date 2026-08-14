# PROGRESS — 学习进度追踪

> 规则：User Confirmation 列只允许用户本人修改（PENDING → PASS + 日期）。
> AI 只能更新"代码 / 测试 / 文档"列；AI 发现越界问题时写入 Backlog，不顺手实现。
> 学习模式：AI 完成代码与测试后生成学习文档，用户通过阅读文档学习。

## 当前阶段

Phase 03 — Agent Loop（实现完成，学习文档已生成，待用户阅读确认）

## 阶段进度

| Phase | 代码 | 测试 | 文档 | User Confirmation |
|---|---|---|---|---|
| Phase 00 项目理解与跑通 | ✅ P0+P1 修复完成 | ✅ smoke test 5/5 | ✅ 已生成（2026-08-15） | PASS |
| Phase 01 Structured Output | ✅ JSON mode + zod + 重试 | ✅ 单测 7 个（共 12/12） | ✅ 已生成（2026-08-15） | PASS |
| Phase 02 Tool Calling | ✅ 2 工具 + 强制 grounding + 双实例 | ✅ 单测 8 个（共 20/20） | ✅ 已生成（2026-08-15） | PASS |
| Phase 03 Agent Loop | ✅ 手写 loop + 双终止 + 检索预算 | ✅ 循环测试 3 个（共 23/23） | ✅ 已生成（2026-08-15） | PENDING |
| Phase 04 State / Memory | 未开始 | - | 模板 | PENDING |
| Phase 05 RAG-lite | 未开始 | - | 模板 | PENDING |
| Phase 06 Planning / Reflection | 未开始 | - | 模板 | PENDING |
| Phase 07 LangGraph | 未开始 | - | 模板 | PENDING |
| Phase 08 Eval & Hardening | 未开始 | - | 待创建 | PENDING |
| Phase 09 Interview Prep | 未开始 | - | 待创建 | PENDING |

## Backlog（越界发现，暂不处理）

- [ ] P2：cors 全开，需收口 + rate limit（Phase 08 处理）
- [ ] P2：nodemon 在 dependencies 而非 devDependencies
- [ ] P2：仓库/目录/包名 "recomend" 拼写错误（建议改 "recommend"，改动大，可选）
- [ ] P2：index.html 标题与 lang 还是脚手架模板值
- [ ] P2：prompt 注入防护（city 直接拼进 prompt）——归 Phase 08 guardrails

## 面试模拟记录

| 日期 | 范围 | 结果 |
|---|---|---|

## Eval 用例积累

| 用例描述 | 所属 Phase | 状态 |
|---|---|---|
| 输出被 ```json 围栏包裹 → 提取成功 | 01 | ✅ 单测覆盖 |
| JSON 前后有说明文字（无围栏）→ 提取成功 | 01 | ✅ 单测覆盖 |
| 输出完全没有 JSON → 抛错触发重试 | 01 | ✅ 单测覆盖 |
| 缺少 dailyItinerary 字段 → 校验失败触发重试 | 01 | ✅ 单测覆盖 |
| ticket 为数字（schema 要求字符串）→ 校验失败触发重试 | 01 | ✅ 单测覆盖 |
| 未知城市查天气 → 返回 error 字段不抛异常 | 02 | ✅ 单测覆盖 |
| 未知工具名（模型幻觉）→ 回传 error ToolMessage | 02 | ✅ 单测覆盖 |
| 景点检索无匹配 → 空结果 + 提示信息 | 02 | ✅ 单测覆盖 |
| 模型无限请求工具 → max_iter 兜底抛明确错误 | 03 | ✅ stub 测试 + 三亚真实实录 |
| 工具失败后下一轮换参数重试并成功 | 03 | ✅ stub 测试 |
