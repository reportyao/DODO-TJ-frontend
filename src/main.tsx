import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { setupGlobalErrorHandlers, suppressKnownWarnings } from './utils/errorHandlers';
import { errorMonitor } from './services/ErrorMonitorService';
import { checkVersion } from './utils/versionCheck';
import { queryClient } from './lib/react-query';

import i18n from './i18n/config';
import './index.css';
import App from './App';
import { UserProvider } from './contexts/UserContext';
import { SupabaseProvider } from './contexts/SupabaseContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { registerServiceWorker } from './utils/pwaUtils';

// 检查版本，防止加载旧版本（必须在最前面）
checkVersion();

// 设置全局错误处理和警告抑制
setupGlobalErrorHandlers();
suppressKnownWarnings();

// 初始化错误监控服务（仅在生产环境启用）
if (import.meta.env.PROD) {
  errorMonitor.init('2.0.0');
}

// 注册 Service Worker 以支持 PWA 离线能力
if ('serviceWorker' in navigator) {
  registerServiceWorker();
}


function AppWrapper() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary>
            <NetworkProvider>
              <SupabaseProvider>
                <UserProvider>
                  <App />
                </UserProvider>
              </SupabaseProvider>
            </NetworkProvider>
          </ErrorBoundary>
        </I18nextProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

// 获取用户语言偏好（在 React 之外使用）
function getFallbackLang(): string {
  try {
    return localStorage.getItem('i18nextLng') || 'tg';
  } catch {
    return 'tg';
  }
}

function getFallbackTexts() {
  const lang = getFallbackLang();
  const texts: Record<string, { loadFailed: string; loadFailedDesc: string; retry: string; appError: string; appErrorDesc: string; reload: string }> = {
    tg: {
      loadFailed: 'Боркунӣ ноком шуд',
      loadFailedDesc: 'Барнома бор нашуд. Ин метавонад аз сабаби мушкилоти шабака бошад.',
      retry: 'Дубора кӯшиш кунед',
      appError: 'Хатои барнома',
      appErrorDesc: 'Оғоз кардани барнома ноком шуд.',
      reload: 'Аз нав бор кунед',
    },
    ru: {
      loadFailed: 'Ошибка загрузки',
      loadFailedDesc: 'Приложение не удалось загрузить. Возможно, это связано с проблемами сети.',
      retry: 'Попробовать снова',
      appError: 'Ошибка приложения',
      appErrorDesc: 'Не удалось инициализировать приложение.',
      reload: 'Перезагрузить',
    },
    zh: {
      loadFailed: '加载失败',
      loadFailedDesc: '应用加载失败，可能是网络问题导致。',
      retry: '重试',
      appError: '应用错误',
      appErrorDesc: '应用初始化失败。',
      reload: '重新加载',
    },
  };
  return texts[lang] || texts['tg'];
}

// 全局加载超时检测
let appMounted = false;
const loadingTimeout = setTimeout(() => {
  if (!appMounted) {
    console.error('[App] Loading timeout detected, showing fallback UI');
    const rootElement = document.getElementById('root');
    if (rootElement) {
      const t = getFallbackTexts();
      rootElement.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; text-align: center; background-color: #f9fafb;">
          <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; margin-bottom: 10px;">${t.loadFailed}</h2>
          <p style="color: #6b7280; margin-bottom: 20px;">${t.loadFailedDesc}</p>
          <button 
            onclick="window.location.reload()" 
            style="background-color: #2B5D3A; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-size: 16px; cursor: pointer;"
          >
            ${t.retry}
          </button>
        </div>
      `;
    }
  }
}, 4000); // 4秒超时

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

try {
  createRoot(rootElement).render(<AppWrapper />);
  appMounted = true;
  clearTimeout(loadingTimeout);
} catch (error) {
  console.error('[App] Failed to mount React app:', error);
  clearTimeout(loadingTimeout);
  const t = getFallbackTexts();
  rootElement.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; text-align: center; background-color: #f9fafb;">
      <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
      <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; margin-bottom: 10px;">${t.appError}</h2>
      <p style="color: #6b7280; margin-bottom: 20px;">${t.appErrorDesc}</p>
      <button 
        onclick="window.location.reload()" 
        style="background-color: #2B5D3A; color: white; padding: 12px 24px; border-radius: 8px; border: none; font-size: 16px; cursor: pointer;"
      >
        ${t.reload}
      </button>
    </div>
  `;
}
