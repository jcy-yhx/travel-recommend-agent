import axios from 'axios'

// 后端接口地址：开发环境走 vite 代理（/api → http://127.0.0.1:3300），
// 其他环境可通过 VITE_API_BASE_URL 环境变量覆盖
export const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '/api/travel/'

//创建axios实例
const request = axios.create({
    baseURL: BASE_URL,
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

// 响应拦截器已把返回值变成 response.data（不再是 AxiosResponse），
// 因此这里显式声明为 Promise<any>，调用方拿到的是后端 body
export function post(url: string, data?: unknown): Promise<any> {
    return request.post(url, data) as Promise<any>
}

export function get(url: string, params?: unknown): Promise<any> {
    return request.get(url, {params}) as Promise<any>
}
