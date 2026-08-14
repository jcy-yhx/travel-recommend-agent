import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 开发环境：/api 开头的请求转发到后端，前端无需硬编码后端地址
      '/api': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true
      }
    }
  }
})
