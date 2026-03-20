import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { DailyProverb } from '../components/ai/DailyProverb';
import { QuickSuggestions } from '../components/ai/QuickSuggestions';
import { AIChat } from '../components/ai/AIChat';
import { UsageQuota } from '../components/ai/UsageQuota';
import { useAIQuota } from '../hooks/ai/useAIQuota';
import { useAIChat } from '../hooks/ai/useAIChat';
import { AIServiceError } from '../lib/aiService';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// 错误消息翻译键映射
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  'QUOTA_EXCEEDED': 'ai.error.quotaExceeded',
  'SENSITIVE_CONTENT': 'ai.error.sensitiveContent',
  'AI_ERROR': 'ai.error.aiError',
  'UNAUTHORIZED': 'ai.error.unauthorized',
  'DEFAULT': 'ai.error.default'
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const CHAT_HISTORY_KEY = 'ai_chat_history';

export default function AIPage() {
  const { t } = useTranslation();
  const { quota, loading, refetch } = useAIQuota();
  const [showWelcome, setShowWelcome] = useState(true);
  const [quickInput, setQuickInput] = useState('');
  
  // 从 localStorage 加载历史聊天记录
  const loadChatHistory = (): Message[] => {
    try {
      const saved = localStorage.getItem(CHAT_HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 将 timestamp 字符串转换回 Date 对象
        return parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
    return [];
  };
  
  const [messages, setMessages] = useState<Message[]>(loadChatHistory());
  const { sendMessage, loading: sending } = useAIChat();
  
  // 保存聊天记录到 localStorage
  const saveChatHistory = (msgs: Message[]) => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(msgs));
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  };
  
  // 当 messages 变化时保存到 localStorage
  React.useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);
  
  // 如果有历史记录，默认显示聊天界面
  React.useEffect(() => {
    if (messages.length > 0) {
      setShowWelcome(false);
    }
  }, []);

  // 处理欢迎页面的快速提问
  const handleQuickSend = async () => {
    const trimmedInput = quickInput.trim();
    
    if (!trimmedInput || sending) return;

    // 添加用户消息到全局状态
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date()
    };
    
    // 添加一个“正在思考”的占位消息
    const thinkingMessage: Message = {
      id: 'thinking',
      role: 'assistant',
      content: t('ai.thinking'),
      timestamp: new Date()
    };
    
    setMessages([userMessage, thinkingMessage]);

    // 清空输入
    setQuickInput('');
    
    // 立即切换到聊天界面
    setShowWelcome(false);

    try {
      // 异步发送消息
      const response = await sendMessage(trimmedInput);
      
      // 添加AI回复到全局状态，替换占位消息
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        timestamp: new Date()
      };
      setMessages([userMessage, aiMessage]);
      
      // 更新配额
      refetch();
      
    } catch (error) {
      console.error('Quick send error:', error);
      
      // 移除占位消息，只保留用户消息
      setMessages([userMessage]);
      
      // 根据错误类型显示不同提示
      let errorMessage = t(ERROR_MESSAGE_KEYS['DEFAULT']);
      
      if (error instanceof AIServiceError) {
        errorMessage = ERROR_MESSAGE_KEYS[error.code] ? t(ERROR_MESSAGE_KEYS[error.code]) : t(ERROR_MESSAGE_KEYS['DEFAULT']);
      } else if (error instanceof Error) {
        errorMessage = error.message || t(ERROR_MESSAGE_KEYS['DEFAULT']);
      }
      
      toast.error(errorMessage, {
        duration: 4000
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuickSend();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 头部 */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-gray-900">DODO AI</h1>
            <p className="text-xs text-gray-600 mt-0.5">и пешрафта барои Тоҷикистон</p>
          </div>
          {!loading && <UsageQuota quota={quota} />}
        </div>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {showWelcome ? (
            <motion.div
              key="welcome"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-y-auto"
            >
              <div className="max-w-2xl mx-auto p-4 space-y-6 pb-24">
                {/* 每日谚语 */}
                <DailyProverb />

                {/* 直接输入框和按钮 - 移到谚语下方 */}
                <div className="space-y-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={quickInput}
                      onChange={(e) => setQuickInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleQuickSend();
                        }
                      }}
                      placeholder={t('ai.placeholder')}
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      disabled={sending}
                      maxLength={500}
                      rows={4}
                      style={{ minHeight: '100px' }}
                    />
                    <button
                      onClick={handleQuickSend}
                      disabled={sending || !quickInput.trim()}
                      className="p-3 bg-blue-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors self-end"
                    >
                      <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* 快捷提问建议 */}
                <QuickSuggestions />

                {/* 使用说明 */}
                <div className="text-center text-xs text-gray-500 space-y-1 px-4">
                  <p className="font-medium">{t('ai.footer')}</p>
                  <p>{t('ai.footerDesc')}</p>
                </div>

                {/* AI免责声明 */}
                <div className="text-center text-xs text-gray-400 mt-4 pb-4">
                  {t('ai.disclaimer')}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full"
            >
              <AIChat 
                initialMessages={messages}
                onMessagesChange={setMessages}
                onBack={() => setShowWelcome(true)} 
                onQuotaUpdate={refetch}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
