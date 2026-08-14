import axios from 'axios'

//创建axios实例
const request = axios.create({
    baseURL: 'http://127.0.0.1:3300/api/travel/',
    timeout: 180000,
    headers: {
        'content-type': 'application/json'
    }
})

//请求拦截器
request.interceptors.request.use(
    config => {
        return config
    },
    error => {
        return Promise.reject(error)
    }
)

//响应拦截器：统一返回 response.data，调用方无需再 .data
request.interceptors.response.use(
    response => {
        return response.data
    },
    error => {
        return Promise.reject(error)
    }
)

export function post(url, data) {
    return request.post(url, data)
}

export function get(url, params) {
    return request.get(url, {params})
}
