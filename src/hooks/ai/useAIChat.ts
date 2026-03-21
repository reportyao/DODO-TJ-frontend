import { useState, useCallback } from 'react';
import { aiService, AIChatResponse, AIServiceError } from '../../lib/aiService';

export interface UseAIChatReturn {
  sendMessage: (message: string) => Promise<AIChatResponse>;
  loading: boolean;
  error: AIServiceError | null;
}

/**
 * AI 对话 Hook
 */
export function useAIChat(): UseAIChatReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AIServiceError | null>(null);

  const sendMessage = useCallback(async (message: string): Promise<AIChatResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await aiService.chat(message);
      return response;
    } catch (err) {
      const aiError = err instanceof AIServiceError 
        ? err 
        : new AIServiceError('AI_ERROR', (err as Error).message || 'Unknown error');
      setError(aiError);
      throw aiError;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    sendMessage,
    loading,
    error
  };
}
