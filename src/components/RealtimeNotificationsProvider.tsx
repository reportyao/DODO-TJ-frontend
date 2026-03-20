import React, { createContext, useContext, ReactNode } from 'react';
import { useRealtimeNotifications, RealtimeNotification } from '@/hooks/useRealtimeNotifications';
import { useUser } from '@/contexts/UserContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface RealtimeNotificationsContextType {
  isConnected: boolean;
  lastMessage: RealtimeNotification | null;
  reconnect: () => void;
  disconnect: () => void;
}

const RealtimeNotificationsContext = createContext<RealtimeNotificationsContextType | undefined>(undefined);

export function useRealtimeNotificationsContext() {
  const context = useContext(RealtimeNotificationsContext);
  if (!context) {
    throw new Error('useRealtimeNotificationsContext must be used within RealtimeNotificationsProvider');
  }
  return context;
}

interface RealtimeNotificationsProviderProps {
  children: ReactNode;
}

export function RealtimeNotificationsProvider({ children }: RealtimeNotificationsProviderProps) {
  // Using react-hot-toast directly
  const { t } = useTranslation();

  const handleNotification = (notification: RealtimeNotification) => {
    const { data } = notification;

    // Show toast notification based on type
    switch (data?.notification_type) {
      case 'group_buy_win':
        toast.success(
          `${t('notifications.groupBuyWin')}\n${t('notifications.groupBuyWinContent', { 
            product: data.data?.product_name 
          })}`
        );
        break;

      case 'group_buy_refund':
        toast(
          `${t('notifications.groupBuyRefund.title')}\n${t('notifications.groupBuyRefund.description', { 
            amount: data.data?.refund_amount 
          })}`
        );
        break;

      case 'wallet_deposit':
        toast.success(
          `${t('notifications.deposit.title')}\n${t('notifications.deposit.description', { 
            amount: data.data?.transaction_amount 
          })}`
        );
        break;

      case 'wallet_withdraw_completed':
        toast.success(
          `${t('notifications.withdrawalCompleted.title')}\n${t('notifications.withdrawalCompleted.description')}`
        );
        break;

      case 'lottery_win':
        toast.success(
          `${t('notifications.lotteryWin')}\n${t('notifications.lotteryWinContent', { 
            product: data.data?.prize_amount 
          })}`
        );
        break;

      default:
        // Generic notification
        if (data?.title) {
          toast(
            `${data.title}\n${data.message}`
          );
        }
    }
  };

  const handleBalanceUpdate = (balance: { balance: number; frozen_balance: number; currency: string }) => {
    // Dispatch custom event for balance update
    window.dispatchEvent(new CustomEvent('balance-updated', { detail: balance }));
  };

  const handleGroupBuyUpdate = (session: any) => {
    // Dispatch custom event for group buy update
    window.dispatchEvent(new CustomEvent('group-buy-updated', { detail: session }));
  };

  const handleError = (error: Error) => {
    console.error('Realtime notifications error:', error);
  };

  // 从 UserContext 获取用户信息，不再依赖 supabase.auth
  const { user, sessionToken, isAuthenticated } = useUser();

  const { isConnected, lastMessage, reconnect, disconnect } = useRealtimeNotifications({
    enabled: isAuthenticated,
    userId: user?.id || null,
    sessionToken: sessionToken,
    onNotification: handleNotification,
    onBalanceUpdate: handleBalanceUpdate,
    onGroupBuyUpdate: handleGroupBuyUpdate,
    onError: handleError,
  });

  return (
    <RealtimeNotificationsContext.Provider
      value={{
        isConnected,
        lastMessage,
        reconnect,
        disconnect,
      }}
    >
      {children}
    </RealtimeNotificationsContext.Provider>
  );
}
