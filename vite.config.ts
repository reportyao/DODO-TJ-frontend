import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import timestampPlugin from './vite-plugin-timestamp.js'
import { compression } from 'vite-plugin-compression2'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const buildTime = new Date().toISOString()
  const appVersion = '2.6.0' // v2.6.0: 首页性能优化（字段瘦身 + 请求合并 + 缓存策略）

  return {
    plugins: [
      react(),
      timestampPlugin(),
      // 生产构建时生成 .gz 预压缩文件，配合 Nginx gzip_static on 使用
      // 覆盖 JS / CSS / JSON（含 i18n 语言包）/ SVG / HTML
      compression({
        algorithm: 'gzip',
        include: /\.(js|css|json|html|svg|xml)$/i,
        threshold: 1024,       // 仅压缩 > 1KB 的文件
        deleteOriginalAssets: false,
      }),
    ],
    
    define: {
      __BUILD_TIME__: JSON.stringify(buildTime),
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    
    base: '/',
    
    server: {
      port: 5173,
      host: true,
      allowedHosts: true,
      cors: {
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
      }
    },
    
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          /**
           * [v2] 手动分包策略优化
           *
           * 目标：减少首屏 JS 体积，提升缓存命中率
           * - vendor: React 核心（变化极少，长期缓存）
           * - supabase: Supabase SDK（独立更新周期）
           * - motion: Framer Motion（体积大，独立缓存）
           * - query: React Query（独立更新周期）
           * - i18n: i18next + 语言包（语言切换时才需要）
           */
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            motion: ['framer-motion'],
            query: ['@tanstack/react-query'],
            i18n: ['i18next', 'react-i18next'],
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            if (name.endsWith('.css')) {
              return 'assets/css/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          }
        }
      },
      chunkSizeWarningLimit: 1000,
      target: 'es2020'
    },
    
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    
    // Optimize dependencies to prevent tree-shaking issues
    optimizeDeps: {
      include: ['framer-motion'],
    },
  }
})
