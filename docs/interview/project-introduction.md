# Project Introduction

## 项目名称

AI Travel Agent — 智能旅游规划 Agent

## 一句话介绍

这是一个基于大语言模型、Tool Calling、RAG、State 和 Agent Workflow 的智能旅游规划系统。

## 30 秒版本

我做了一个 AI 旅游规划 Agent。用户输入目的地、日期、预算和偏好后，Agent 会根据任务自主调用天气、景点、路线等工具，并结合旅游知识库进行规划，最后输出结构化行程。项目从最初的 LLM 应用逐步升级为带工具调用和状态管理的 Agent。

## 3 分钟版本结构

1. 为什么做
2. 原始版本架构
3. 为什么原始版本不是完整 Agent
4. 如何加入 Structured Output
5. 如何加入 Tool Calling
6. 如何实现 Agent Loop
7. 如何加入 State / Memory
8. 如何加入 RAG
9. 如何进行 Planning / Reflection
10. 为什么最后使用 LangGraph
11. 遇到过什么问题
12. 如何测试和优化

## 必须自己能够解释

- Agent 为什么需要 Tool
- Tool Calling 如何发生
- Agent Loop 如何结束
- State 保存什么
- RAG 解决什么问题
- Planning 解决什么问题
- LangGraph 为什么有价值
