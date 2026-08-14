# PROGRESS — 学习进度追踪

> 规则：User Confirmation 列只允许用户本人修改（PENDING → PASS + 日期）。
> AI 只能更新"代码 / 测试 / 文档"列；AI 发现越界问题时写入 Backlog，不顺手实现。
> 学习模式：AI 完成代码与测试后生成学习文档，用户通过阅读文档学习。

## 当前阶段

Phase 00 — 项目理解与跑通（P0/P1 修复完成，学习文档已生成，待用户阅读确认）

## 阶段进度

| Phase | 代码 | 测试 | 文档 | User Confirmation |
|---|---|---|---|---|
| Phase 00 项目理解与跑通 | ✅ P0+P1 修复完成 | ✅ smoke test 5/5 | ✅ 已生成（2026-08-15） | PASS |
| Phase 01 Structured Output | 未开始 | - | 模板 | PENDING |
| Phase 02 Tool Calling | 未开始 | - | 模板 | PENDING |
| Phase 03 Agent Loop | 未开始 | - | 模板 | PENDING |
| Phase 04 State / Memory | 未开始 | - | 模板 | PENDING |
| Phase 05 RAG-lite | 未开始 | - | 模板 | PENDING |
| Phase 06 Planning / Reflection | 未开始 | - | 模板 | PENDING |
| Phase 07 LangGraph | 未开始 | - | 模板 | PENDING |
| Phase 08 Eval & Hardening | 未开始 | - | 待创建 | PENDING |
| Phase 09 Interview Prep | 未开始 | - | 待创建 | PENDING |

## Backlog（越界发现，暂不处理）

- [ ] P2：cors 全开，需收口 + rate limit（Phase 08 处理）
- [ ] P2：nodemon 在 dependencies 而非 devDependencies
- [ ] P2：docs/ 与 AGENT.md 尚未纳入 git（待用户要求 commit 时一并提交）
- [ ] P2：仓库/目录/包名 "recomend" 拼写错误（建议改 "recommend"，改动大，可选）
- [ ] P2：index.html 标题与 lang 还是脚手架模板值
- [ ] P2：prompt 注入防护（city 直接拼进 prompt）——归 Phase 08 guardrails

## 面试模拟记录

| 日期 | 范围 | 结果 |
|---|---|---|

## Eval 用例积累

| 用例描述 | 所属 Phase | 状态 |
|---|---|---|
