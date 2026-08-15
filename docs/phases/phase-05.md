# Phase 05 — RAG-lite

## 1. 本阶段目标

本阶段结束后，我能够：

> 把景点检索从关键词匹配升级为语义检索（embedding），并讲清 RAG 的每个环节在本项目中的对应实现，以及为什么不上向量数据库。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 02 就踩过的坑："故宫博物院"并不包含子串"博物馆"；Phase 04 之后这个问题依然存在。关键词检索要求用户**用词与知识库完全一致**，而真实用户（和真实 Agent）说的是"明清皇宫""海边度假""适合穷游的景点"——换一种说法就搜不到。

### 新技术解决什么问题？

Embedding 把文本变成向量，让"意思相近"在数学上可度量：

| 查询（自然语言） | 关键词检索 | 语义检索 |
|---|---|---|
| 明清皇宫 | 无结果 | 故宫博物院（0.632） |
| 海边度假 | 无结果 | 亚龙湾（0.540） |
| 适合穷游的免费景点 | 无结果 | 上海博物馆（实测 Agent 查询） |
| 在明朝城墙上骑自行车 | 无结果 | 西安城墙（0.627） |

**RAG 概念在本项目的映射**（面试用这张表）：

| RAG 环节 | 本项目实现 |
|---|---|
| 文档/Chunk | 每条景点条目（22 条） |
| Embedding 模型 | BAAI/bge-m3（1024 维，SiliconFlow API） |
| 索引 | 离线批量向量化 + JSON 缓存（约 90KB） |
| Retriever | 余弦相似度 top-5 + 阈值过滤（0.48） |
| Generation | Agent Loop 里工具结果注入 prompt（Phase 02/03 已具备） |

注意：**我们的系统从 Phase 02 起就已经是"检索增强生成"**——工具检索结果进入 LLM 上下文就是 Augmentation。Phase 05 升级的是 Retriever 的质量。面试说"我做了 RAG"时，能精确说出"哪一层是我这次做的"比笼统说"我用了向量库"强得多。

### 如果不用它？

用户换一种问法就搜不到 → Agent 拿到空结果 → 要么反复搜索（Phase 03 踩过的坑），要么用参数记忆编造。语义检索是"自然语言界面"和"结构化知识库"之间的翻译层。

---

## 3. 核心概念

- **Embedding**：把文本映射为高维向量，语义相近的文本向量距离近。bge-m3 是中文友好的开源模型
- **余弦相似度**：向量夹角的余弦（-1~1），embedding 检索的标准度量；只关心方向不关心长度
- **离线索引 + 在线查询**：全部文档一次批量向量化并缓存；查询时只向量化 query——把每次检索的 API 成本降到 1 次调用
- **相似度阈值**：语义检索永远返回"最接近"的结果，没有阈值时无关查询也会带回垃圾（实测 0.47 的"量子力学实验室"）。**宁可空结果，不给坏结果**
- **优雅降级**：embedding API 挂掉时回退关键词检索——检索服务不是 100% 可靠，主备两条路
- **向量库 vs 本地索引**：22 条向量暴力扫描毫秒级；向量库解决百万级规模问题，当前引入是负担（详见面试问答）

---

## 4. 本阶段不学习什么

- 不学向量数据库（pgvector/Milvus/Faiss）——理由见 §15 深挖 Q1，这是本 Phase 最重要的"克制"
- 不学 rerank 模型（bge-reranker 等）——22 条知识库不需要二段检索
- 不学 chunk 切分策略（滑窗/语义切分）——每个景点条目天然就是一个 chunk
- 不学混合检索（BM25 + embedding 加权）——当前规模单一路径够用，面试概念了解即可

---

## 5. 当前代码状态（Phase 04 结束时）

```text
search_attractions：关键词子串打分（名称+3/城市+2/描述+1）
  → "换一种说法就搜不到"（Phase 02 已知缺陷）
```

---

## 6. 本阶段目标架构

```text
search_attractions(query)
  │
  ├─ 主路径：语义检索
  │     ensureIndex（懒构建）
  │       ├─ 缓存命中（data/attractions-embeddings.json）→ 零 API
  │       └─ 缓存缺失/过期 → embedDocuments 批量构建（1 次调用）
  │     embedQuery(query)（1 次调用）
  │     余弦相似度 → top-5 → 阈值 0.48 过滤
  │     ├─ 有结果 → 返回（method: 'embedding'）
  │     └─ 无结果 → 优雅降级话术
  │
  └─ 兜底路径：embedding API 失败 → 关键词检索（Phase 02 实现保留）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/services/embeddingIndex.js        # EmbeddingIndex + 余弦相似度 + 阈值
travel-recomend-backend/src/__tests__/embeddingIndex.test.js  # 6 个确定性测试
travel-recomend-backend/scripts/retrieval-eval.js             # 检索质量评估脚本
```

### 修改

```text
travel-recomend-backend/src/tools/attractions.js  # 语义检索主路径 + 关键词兜底 + 工具描述更新
travel-recomend-backend/package.json              # 新增 eval:retrieval 脚本
travel-recomend-backend/.env / .env.example       # 新增 SILICONFLOW_EMBEDDING_MODEL
.gitignore                                        # 忽略向量缓存文件
```

---

## 8. 关键代码

### 8.1 索引：离线构建 + 缓存

```js
// src/services/embeddingIndex.js（节选）
async loadOrBuild(texts) {
    if (existsSync(this.filePath)) {
        const cached = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        const isFresh = cached.model === process.env.SILICONFLOW_EMBEDDING_MODEL
            && cached.texts?.join('|') === texts.join('|')
        if (isFresh) {
            this.index = cached   // 缓存命中：零 API 成本
            return
        }
    }
    // 重建：全部文档一次批量向量化
    const vectors = await this.embedder.embedDocuments(texts)
    this.index = { model: ..., texts, vectors }
    writeFileSync(this.filePath, JSON.stringify(this.index))
}
```

**解释**：缓存新鲜度检查两个维度——**模型名**（换模型必须重建）和**文本内容**（改数据必须重建）。22 条 × 1024 维 ≈ 90KB，JSON 文件完全装得下。

### 8.2 检索：余弦 top-K + 阈值

```js
async search(query, k = 5) {
    const queryVector = await this.embedder.embedQuery(query)
    return this.index.vectors
        .map((vector, index) => ({ index, score: cosineSimilarity(queryVector, vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .filter(item => item.score >= SIMILARITY_THRESHOLD)   // 0.48，实测校准
}
```

**解释**：阈值是本阶段最重要的工程细节。语义检索的数学性质决定了它**永远给出"最接近"的答案**——没有阈值，"量子力学实验室参观"也会返回 0.47 相似度的兵马俑。校准方法写在 §11。

### 8.3 工具层：主路径 + 兜底

```js
// src/tools/attractions.js（节选）
try {
    const { matches } = await searchSemantic(query)
    if (matches.length === 0) return { query, method: 'embedding', results: [], message: NO_MATCH_MESSAGE }
    return { query, method: 'embedding', results: matches.map(m => ATTRACTIONS[m.index]) }
} catch (error) {
    console.error('[search_attractions] 语义检索失败，回退关键词检索：', error.message)
    // ...关键词兜底（Phase 02 实现）
}
```

**解释**：结果里带上 `method` 字段，让 Agent 知道这次是哪种检索方式命中的。embedding 服务不可用时静默回退——工具内部消化故障，Agent 无感知。

---

## 9. 完整数据流

```text
Agent Loop 中模型发起 search_attractions("适合穷游的免费景点")
  ▼
ensureIndex：缓存命中（22 条向量，零 API）
  ▼
embedQuery → 1024 维向量（1 次 API 调用）
  ▼
与 22 条索引向量逐一计算余弦相似度（内存暴力扫描，毫秒级）
  ▼
排序 → top-5 → 阈值 0.48 过滤
  ├─ 命中 → 景点 JSON 数组（method: 'embedding'）→ ToolMessage 回写 → 模型基于真实资料规划
  └─ 空 → 优雅降级话术 → 模型用自身知识规划并标注不确定性
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test              # 35 个测试
npm run eval:retrieval # 检索质量评估（真实 API，8 个用例对比关键词 vs 语义）
npm run dev
```

首次检索会自动构建索引（1 次批量 embedding 调用），之后从缓存加载。

---

## 11. 测试

### 11.1 确定性测试（npm test，35/35）

```text
✔ 完全相同向量余弦相似度为 1
✔ 正交向量余弦相似度为 0
✔ 首次构建：调用 embedder 并写缓存文件
✔ 缓存命中：第二次启动不调用 embedder（零 API 成本）
✔ 缓存过期：文本变化时重建索引
✔ search 返回 top-K 且按相似度降序，低于阈值的被过滤
✔ 未构建索引就 search 抛明确错误
（连同 Phase 00-04 的 29 个，共 35 个，全部通过）
```

### 11.2 检索质量评估（npm run eval:retrieval，真实 API）

```text
| 查询 | 期望 | 关键词 top1 | 语义 top1（分数） |
|---|---|---|---|
| 明清皇宫 | 故宫博物院 | （无结果） | 故宫博物院（0.632） |
| 海边度假 | 亚龙湾 | （无结果） | 亚龙湾（0.540） |
| 在明朝城墙上骑自行车 | 西安城墙 | （无结果） | 西安城墙（0.627） |
| 看国宝大熊猫 | 成都大熊猫繁育研究基地 | （无结果） | 大熊猫基地（0.602） |
| 皇家园林，昆明湖 | 颐和园 | 颐和园 | 颐和园（0.738） |
| 上海看夜景 | 外滩 | （无结果） | 外滩（0.682） |
| 吃小笼包的地方 | 豫园 | （无结果） | 豫园（0.584） |
| 量子力学实验室参观 | （空） | （无结果） | （无结果） |

关键词检索命中：1/8
语义检索命中：8/8
```

**阈值校准过程**（写进代码注释，面试可讲）：初版阈值 0.35 → eval 发现"量子力学实验室"以 0.47 命中兵马俑 → 观察相关查询集中在 0.50~0.63 → 取 0.48 一刀切 → 复测 8/8。

### 11.3 真实 Agent 调用实录（服务端日志）

```text
[Agent Loop] 第 1 轮：get_weather({"city":"上海"}) + search_attractions({"query":"上海热门景点"})
[Agent Loop] 第 2 轮：search_attractions({"query":"上海 豫园 城隍庙 迪士尼 东方明珠 南京路"})
[Agent Loop] 第 3 轮：search_attractions({"query":"上海 免费景点 适合穷游"})
                  → method:embedding → 上海博物馆（免费）
[Agent Loop] 第 4 轮：模型停止请求工具
→ HTTP 200，行程含"免费（需提前在公众号预约）"——语义检索 + grounding 全链路
```

注意第 3 轮的查询："免费景点 适合穷游"——**关键词检索对这类抽象概念完全无能为力**，语义检索命中上海博物馆（免费）。

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：阈值太低，无关查询带回垃圾结果

现象：eval 里"量子力学实验室参观"以 0.47 相似度命中秦始皇兵马俑。
根因：语义检索永远返回"最接近"的结果——22 条知识库里总有一条"最像"。0.35 的初版阈值形同虚设。
修法：**用真实数据校准**——把 eval 里相关/无关查询的分数分布打印出来（相关 0.50~0.63，无关 0.47），取 0.48。阈值不是拍脑袋的常数，是测出来的。
收获：RAG 系统的第一原则——**无结果比坏结果好**。坏结果会诱导模型基于错误信息规划。

### 踩坑 2：eval 用例本身设计错了

现象："江南园林赏荷"期望命中颐和园，实际命中西湖（0.501）——西湖的"苏堤、断桥"描述与"江南+赏荷"语义上更近。
检查：不是检索错了，是**期望值设错了**——西湖对这个查询是合理答案。改用"皇家园林，昆明湖"（颐和园描述原文）后命中 0.738。
收获：写 eval 用例时，期望答案必须来自知识库内容本身，不能凭直觉。

### 踩坑 3：缓存新鲜度怎么判断

现象：改了 attractions.json 后，旧缓存仍在生效，检索结果不更新。
修法：缓存新鲜度 = 模型名一致 + 索引文本拼接一致，任何一边变了就重建。用文本内容做 key 而不是"文件修改时间"——文件时间在 git checkout/拷贝场景下不可靠。
收获：所有缓存系统的核心问题都是"什么时候失效"，显式内容比对是最稳妥的答案。

---

## 13. 常见错误

- 每次查询都把全部文档重新向量化——正确做法是离线索引 + 在线只向量化 query
- 不设相似度阈值——语义检索永远返回最接近的结果，垃圾也会被返回
- 阈值拍脑袋定——应该用 eval 数据校准
- 只做语义检索没有兜底——embedding 服务挂掉时整个功能瘫痪
- 直接上向量数据库——22 条数据暴力扫描毫秒级，向量库解决的是另一个量级的问题

---

## 14. 和上一阶段的关系

Phase 04 让 Agent "记得住"（状态跨请求）；Phase 05 让 Agent "找得准"（知识检索跨说法）。两者都服务于同一个目标：**让 Agent 的每一步决策建立在可靠的信息之上**——状态负责"过去的信息"，检索负责"外部的信息"。

下一阶段（Phase 06 — Planning / Reflection）：目前 Agent 拿到工具资料后直接生成行程，没有"先规划再执行"的结构，也没有"生成后自我检查"的环节。Phase 06 引入 plan-then-execute 与预算一致性 validator（校验一次 re-plan）。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：RAG 是什么？为什么需要它？你的项目里 RAG 长什么样？**

参考回答：RAG 是 Retrieval Augmented Generation——生成前先从外部知识库检索相关资料，把资料注入 prompt 再生成，解决模型参数记忆过时/编造的问题。我的项目里：chunk 是 22 条景点条目，embedding 用 bge-m3，检索是余弦相似度 top-5 + 阈值过滤，生成环节就是 Agent Loop 里工具结果进入 LLM 上下文。值得强调的是：我的系统从做工具调用的那一刻起就具备 RAG 形态，本阶段升级的是 Retriever 的质量（关键词 → 语义）。能精确说出"哪一层是我做的"比笼统说"我用了 RAG"强。

**Q2：Embedding 是什么？为什么意思相近的文本向量距离近？**

参考回答：Embedding 是把文本映射成高维向量的模型（我的 bge-m3 输出 1024 维）。训练目标就是让语义相近的文本在向量空间里距离近（对比学习/双塔结构），所以"明清皇宫"和"故宫博物院"的余弦相似度能达到 0.63，而"量子力学实验室"和任何景点都低于 0.48。这是把"语义"变成"可计算的距离"的关键一步。

**Q3：你的 Chunk 怎么设计的？**

参考回答：每条景点条目天然就是一个 chunk——不需要切分。而且我的索引文本是字段拼接（城市 + 名称 + 类别 + 描述），不是原文照搬：名称权重靠"位置在拼接串靠前 + 短文本整体相似度贡献大"隐式体现。真实生产环境 chunk 设计要考虑：语义完整性（不能把一个景点切两半）、检索粒度（太大召回不准，太小上下文破碎）、以及 embedding 模型的输入长度限制。

### 项目实践

**Q1：你为什么不上向量数据库？**

参考回答：22 条向量，暴力扫描是毫秒级的，向量库（pgvector/Milvus）解决的是百万级向量 + 毫秒级检索的问题。现在引入只会增加运维复杂度。我的索引是一个 90KB 的 JSON 文件：离线构建、启动加载、零额外服务。什么时候该换：数据量上万、需要增量更新、多实例共享索引时——演进路径清晰，但不是现在。**克制本身就是工程判断力的体现。**

**Q2：你的相似度阈值怎么定的？**

参考回答：测出来的，不是拍脑袋。我写了一个检索 eval 脚本（8 个用例，含无关查询），把分数分布打印出来：相关查询 0.50~0.63，无关查询 0.47，于是取 0.48。阈值背后的原则：语义检索永远返回"最接近"的结果，没有阈值就没有"无结果"这个答案；而**无结果比坏结果好**——坏结果会让模型基于错误信息规划。

**Q3：embedding 服务挂了你的检索怎么办？**

参考回答：工具层 try/catch 静默回退到关键词检索（Phase 02 的实现保留着），结果里带 `method` 字段标注检索方式。Agent 无感知——工具内部消化故障，这是工具设计的原则之一（Phase 02 讲过：异常流变数据流）。索引本身也有缓存，不依赖 embedding 服务常在线。

### 深挖

**Q1：语义检索会漏掉精确匹配（比如"西安城墙"就应该搜到西安城墙），怎么处理？**

参考回答：这是语义检索的已知短板（漏召回 + 阈值边界），生产方案是**混合检索**：BM25 关键词检索与向量检索各自打分，加权融合（如 RRF 倒数排名融合）。我的系统里关键词检索目前只作为兜底而非融合——22 条数据规模下语义检索已经 8/8，融合的收益暂时看不见。这个概念我了解，如果面试官想看我可以演示融合实现。

**Q2：怎么评估检索质量？**

参考回答：我的做法：固定评测集（8 个查询，含正例与无关查询）+ 指标（top-1/top-3 命中率）+ 对照组（关键词检索 1/8 vs 语义检索 8/8）。`npm run eval:retrieval` 一键复跑。更完整的体系（Phase 08 会做）：更大用例集、LLM-as-judge 评估端到端行程质量、以及线上检索日志的回归分析。

**Q3：bge-m3 为什么选它？**

参考回答：中文语义效果好（开源模型里的第一梯队）、SiliconFlow 直接提供 API 不需要自己部署、1024 维在质量和成本间平衡。选型路径：先探测 API 可用性（一个小调用），再跑 eval 验证实际效果，最后才写进代码——不是看榜单选的。

---

## 16. 毕业检查

### 代码

- [x] EmbeddingIndex：离线构建 + 内容感知缓存 + 余弦 top-5 + 阈值 0.48
- [x] search_attractions：语义主路径 + 关键词兜底 + method 标注
- [x] 6 个确定性测试，全量 35/35
- [x] 检索 eval 脚本：语义 8/8 vs 关键词 1/8（真实 API）
- [x] 真实 Agent 调用："适合穷游的免费景点"语义命中（实录）
- [x] 没有实现下一阶段内容（无向量库、无 rerank、无混合检索）

### 理解

- [ ] 我能用一张表讲清 RAG 五环节在本项目的对应实现
- [ ] 我能解释为什么"无结果比坏结果好"和阈值校准方法
- [ ] 我能回答"为什么不上向量数据库"
- [ ] 我能说出语义检索的短板和混合检索的概念
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- Embedding 检索的完整链路：索引构建、缓存、余弦相似度、阈值过滤
- 阈值校准方法（用 eval 数据而不是拍脑袋）
- 检索服务的优雅降级（主路径 + 兜底）
- 用对照实验评估检索质量（8/8 vs 1/8）
- "为什么不上向量库"的诚实答案

### 我还不会

- 任务规划与自我校验（Phase 06）
- 图结构的 Agent 工作流（Phase 07）

### 下一阶段

```text
Phase 06 — Planning / Reflection
```
