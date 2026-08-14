import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWeather } from '../tools/weather.js'
import { searchAttractions } from '../tools/attractions.js'
import { executeToolCall, TOOLS } from '../tools/index.js'

// 工具的确定性单元测试：不调用 LLM，直接测工具实现与 executeToolCall 的失败处理。

// ---------- get_weather ----------

test('查询已知城市返回天气数据', async () => {
    const result = await getWeather.invoke({ city: '北京' })
    assert.equal(result.city, '北京')
    assert.equal(typeof result.condition, 'string')
    assert.equal(typeof result.temperature, 'number')
})

test('查询未知城市返回 error 字段而不是抛异常', async () => {
    const result = await getWeather.invoke({ city: '不存在的城市' })
    assert.equal(result.city, '不存在的城市')
    assert.equal(typeof result.error, 'string')
})

// ---------- search_attractions ----------

test('按城市检索返回该城市景点', async () => {
    const result = await searchAttractions.invoke({ query: '成都' })
    assert.ok(result.results.length >= 2)
    assert.ok(result.results.every(attr => attr.city === '成都'))
})

test('按"城市+关键词"组合检索，名称命中排第一', async () => {
    const result = await searchAttractions.invoke({ query: '成都 熊猫' })
    assert.ok(result.results.length >= 1)
    // 名称命中"熊猫"且城市命中"成都"的应排第一
    assert.equal(result.results[0].name, '成都大熊猫繁育研究基地')
})

test('无匹配关键词返回空结果和提示', async () => {
    // 注意：关键词检索是子串匹配，"基地"会命中"大熊猫繁育研究基地"，
    // 因此这里用不可能作为子串出现的关键词
    const result = await searchAttractions.invoke({ query: '火星' })
    assert.equal(result.results.length, 0)
    assert.equal(typeof result.message, 'string')
})

// ---------- executeToolCall（工具分发与失败处理） ----------

test('执行合法工具调用返回 ToolMessage', async () => {
    const result = await executeToolCall({
        name: 'get_weather',
        args: { city: '杭州' },
        id: 'call_test_1'
    })
    assert.equal(result.tool_call_id, 'call_test_1')
    const content = JSON.parse(result.content)
    assert.equal(content.city, '杭州')
})

test('未知工具名返回 error ToolMessage（不抛异常）', async () => {
    const result = await executeToolCall({
        name: 'hack_the_planet',
        args: {},
        id: 'call_test_2'
    })
    assert.equal(result.tool_call_id, 'call_test_2')
    const content = JSON.parse(result.content)
    assert.match(content.error, /未知工具/)
})

test('白名单工具集包含两个工具', () => {
    const names = TOOLS.map(t => t.name)
    assert.deepEqual(names, ['get_weather', 'search_attractions'])
})
