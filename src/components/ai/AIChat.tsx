import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PaperAirplaneIcon, ArrowLeftIcon } from '@heroicons/react/24/solid';
import { useAIChat } from '../../hooks/ai/useAIChat';
import { MessageBubble } from './MessageBubble';
import { AIServiceError } from '../../lib/aiService';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIChatProps {
  initialMessages?: Message[];
  onMessagesChange?: (messages: Message[]) => void;
  onBack: () => void;
  onQuotaUpdate: () => void;
}

// 错误消息翻译键映射
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  'QUOTA_EXCEEDED': 'ai.error.quotaExceeded',
  'SENSITIVE_CONTENT': 'ai.error.sensitiveContent',
  'AI_ERROR': 'ai.error.aiError',
  'UNAUTHORIZED': 'ai.error.unauthorized',
  'DEFAULT': 'ai.error.default'
};

export function AIChat({ initialMessages = [], onMessagesChange, onBack, onQuotaUpdate }: AIChatProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  
  // 当 initialMessages 变化时，更新 messages
  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);
  
  // 同步messages到父组件
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages);
    }
  }, [messages, onMessagesChange]);
  const [input, setInput] = useState('');
  const { sendMessage, loading } = useAIChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    // 使用 requestAnimationFrame 确保在 DOM 更新后再滚动
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  // 只在新消息添加时自动滚动到底部，避免频繁滚动导致抖动
  const prevMessagesLengthRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      scrollToBottom();
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  const handleSend = async () => {
    const trimmedInput = input.trim();
    
    if (!trimmedInput || loading) return;

    // 添加用户消息
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');

    try {
      // 调用 AI API
      const response = await sendMessage(trimmedInput);
      
      // 添加 AI 回复
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: response.message,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // 更新次数
      onQuotaUpdate();
      
    } catch (error) {
      console.error('AI chat error:', error);
      
      // 根据错误类型显示不同提示
      let errorMessage = t(ERROR_MESSAGE_KEYS['DEFAULT']);
      
      if (error instanceof AIServiceError) {
        errorMessage = ERROR_MESSAGE_KEYS[error.code] ? t(ERROR_MESSAGE_KEYS[error.code]) : (error.message || t(ERROR_MESSAGE_KEYS['DEFAULT']));
      }
      
      toast.error(errorMessage, {
        duration: 4000
      });
    }

    // 重新聚焦输入框
    inputRef.current?.focus();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 返回按钮 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">{t('ai.backButton')}</span>
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-sm">{t('ai.emptyStateTitle')}</p>
            <p className="text-xs mt-2">{t('ai.emptyStateDesc')}</p>
          </div>
        )}
        
        {messages.map(message => (
            <MessageBubble key={message.id} message={message} />
          ))}

        {/* 加载动画 */}
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-gray-500"
          >
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-sm">{t('ai.thinking')}</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex items-end gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t('ai.placeholder')}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            disabled={loading}
            maxLength={1000}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="p-3 bg-primary text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-dark transition-colors"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
        
        {/* 字符计数 */}
        {input.length > 0 && (
          <div className="text-xs text-gray-500 mt-2 text-right">
            {input.length}/1000
          </div>
        )}
        
        {/* AI免责声明 */}
        <div className="text-center text-xs text-gray-400 mt-2">
          {t('ai.disclaimer')}
        </div>
      </div>
    </div>
  );
}
