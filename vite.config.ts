import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import timestampPlugin from './vite-plugin-timestamp.js'
import { compression } from 'vite-plugin-compression2'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const buildTime = new Date().toISOString()
  const appVersion = '2.5.3' // 升级版本号：性能优化（gzip 预压缩 + WebP 图片）

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
      minify: 'esbuild',  // Use esbuild instead of terser to avoid tree-shaking issues
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            motion: ['framer-motion'],
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
