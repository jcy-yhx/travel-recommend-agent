# Interview Questions

本文件用于最终面试准备。

## 项目介绍

### 1 分钟

回答：

- 项目是什么？
- 解决什么问题？
- 使用什么技术？
- Agent 的核心能力是什么？

### 3 分钟

回答：

- 系统架构
- 前后端
- LLM
- Tools
- Agent Loop
- State / Memory
- RAG
- LangGraph

## 高频问题

### Agent

1. 什么是 Agent？
2. LLM Application 和 Agent 有什么区别？
3. Agent Loop 是什么？
4. Agent 怎么决定调用哪个 Tool？

### Tool Calling

1. Function Calling 和普通 API 调用有什么区别？
2. Tool Schema 为什么重要？
3. Tool 调用失败怎么办？

### RAG

1. 为什么需要 RAG？
2. Chunk 怎么设计？
3. Embedding 是什么？
4. Retriever 做什么？

### LangGraph

1. 为什么使用 LangGraph？
2. Node、Edge、State 分别是什么？
3. LangGraph 和自己实现 Agent Loop 有什么关系？

## 项目深挖

面试官可能追问：

- 如果天气 API 挂了怎么办？
- 如果 Agent 无限调用 Tool 怎么办？
- 如果预算超过怎么办？
- 如何评估 Agent 是否真的规划得更好？
- 如何控制 Token 和成本？
- 如何防止模型调用危险工具？
- 如何记录 Agent 的执行轨迹？
- 如何测试 Agent？
