import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_ATTRACTION_SEARCHES,
    MAX_WEATHER_CALLS,
    partitionToolCalls
} from '../graphs/travelAgentGraph.js'

const call = (name, id) => ({ name, id, args: {} })

test('单轮混合调用按天气 1 次、景点检索 2 次硬限制切分', () => {
    const result = partitionToolCalls([
        call('get_weather', 'w1'),
        call('get_weather', 'w2'),
        call('search_attractions', 's1'),
        call('search_attractions', 's2'),
        call('search_attractions', 's3')
    ])

    assert.deepEqual(result.executable.map(item => item.id), ['w1', 's1', 's2'])
    assert.deepEqual(result.skipped.map(item => item.id), ['w2', 's3'])
    assert.equal(result.weatherCalls, MAX_WEATHER_CALLS)
    assert.equal(result.attractionSearches, MAX_ATTRACTION_SEARCHES)
})

test('已耗尽配额的已知工具不再可执行', () => {
    const result = partitionToolCalls([
        call('get_weather', 'w2'),
        call('search_attractions', 's3')
    ], { weatherCalls: MAX_WEATHER_CALLS, attractionSearches: MAX_ATTRACTION_SEARCHES })

    assert.equal(result.executable.length, 0)
    assert.deepEqual(result.skipped.map(item => item.id), ['w2', 's3'])
})

test('未知工具不占已知工具配额，交由原有错误处理和 max_iter 兜底', () => {
    const result = partitionToolCalls([call('unknown_tool', 'u1')])

    assert.deepEqual(result.executable.map(item => item.id), ['u1'])
    assert.equal(result.weatherCalls, 0)
    assert.equal(result.attractionSearches, 0)
})
