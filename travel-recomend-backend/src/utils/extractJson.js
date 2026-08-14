// 从 LLM 输出文本中提取 JSON 对象。
// 按优先级依次尝试：
//   1. ```json 代码围栏
//   2. ``` 通用代码围栏
//   3. 第一个 { 到最后一个 } 之间（容忍 JSON 前后有说明文字）
//
// 已知局限：第 3 条用 lastIndexOf('}') 贪婪匹配，如果 JSON 后面的尾随文本
// 里也出现 "}"，会提取失败。开启 JSON mode 后模型只输出 JSON，此路径只是兜底。
export function extractJson(text) {
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (fenced) return fenced[1]

    const generic = text.match(/```\s*([\s\S]*?)\s*```/)
    if (generic) return generic[1]

    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
        return text.slice(start, end + 1)
    }

    throw new Error('模型输出中找不到 JSON 对象')
}
