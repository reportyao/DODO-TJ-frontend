import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite 插件：构建时自动执行以下操作：
 *   1. 更新 public/version.json 的 buildTime
 *   2. 自动同步 i18n 翻译文件（src/i18n/locales/ → public/locales/）
 *   3. 替换 HTML 中的 __BUILD_TIME__ 占位符
 * 
 * i18n 同步说明：
 *   项目存在两套 i18n 文件，src/i18n/locales/ 是唯一编辑入口（Single Source of Truth），
 *   public/locales/ 是供 HTTP 动态加载的副本。构建时自动同步，杜绝手动遗漏。
 */
export default function timestampPlugin() {
  const buildTime = new Date().toISOString();
  
  return {
    name: 'vite-plugin-timestamp',
    buildStart() {
      const root = process.cwd();

      // ── 步骤 1：自动同步 i18n 翻译文件 ──────────────────────────────
      const LANGUAGES = ['ru', 'tg', 'zh'];
      const srcDir = resolve(root, 'src/i18n/locales');
      const pubDir = resolve(root, 'public/locales');
      
      let syncCount = 0;
      for (const lang of LANGUAGES) {
        const srcPath = resolve(srcDir, `${lang}.json`);
        const pubPath = resolve(pubDir, `${lang}.json`);
        
        if (!existsSync(srcPath)) {continue;}
        
        try {
          const srcContent = readFileSync(srcPath, 'utf-8');
          const pubContent = existsSync(pubPath) ? readFileSync(pubPath, 'utf-8') : '';
          
          if (srcContent !== pubContent) {
            copyFileSync(srcPath, pubPath);
            syncCount++;
            console.log(`[i18n-sync] 🔄 ${lang}.json → public/locales/${lang}.json`);
          }
        } catch (e) {
          console.warn(`[i18n-sync] Failed to sync ${lang}.json:`, e.message);
        }
      }
      
      if (syncCount > 0) {
        console.log(`[i18n-sync] ✅ 已同步 ${syncCount} 个翻译文件`);
      } else {
        console.log(`[i18n-sync] ✅ 翻译文件已一致，无需同步`);
      }

      // ── 步骤 2：自动更新 public/version.json 的 buildTime ──────────
      try {
        const versionPath = resolve(root, 'public/version.json');
        const versionData = JSON.parse(readFileSync(versionPath, 'utf-8'));
        versionData.buildTime = buildTime;
        writeFileSync(versionPath, JSON.stringify(versionData, null, 2) + '\n');
        console.log(`[timestamp] Updated version.json buildTime: ${buildTime}`);
      } catch (e) {
        console.warn('[timestamp] Failed to update version.json:', e.message);
      }
    },
    transformIndexHtml(html) {
      // 仅替换 __BUILD_TIME__ 占位符（用于 HTML 注释中的构建时间标记）
      return html.replace(/__BUILD_TIME__/g, buildTime);
    }
  };
}
