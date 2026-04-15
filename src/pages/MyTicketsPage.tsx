import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import {
  TicketIcon,
  TrophyIcon,
  ClockIcon,
  ArrowLeftIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { LazyImage } from '../components/LazyImage';
import { formatDateTime, copyToClipboard } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useUser } from '../contexts/UserContext';
import toast from 'react-hot-toast';

interface Ticket {
  id: string;
  numbers: string; // 7位数处理订单码
  created_at: string;
  is_winning: boolean;
}

interface LotteryInfo {
  id: string;
  period: string;
  title: string;
  image_url: string;
  ticket_price: number;
  total_tickets: number;
  sold_tickets: number;
  status: string;
  winning_numbers?: string[]; // 获奖号码数组
  winning_user_id?: string;
}

const MyTicketsPage: React.FC = () => {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const lotteryId = params.id;

  const [lottery, setLottery] = useState<LotteryInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadTickets = useCallback(async () => {
    if (!lotteryId || !user?.id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // 获取商城信息
      const { data: lotteryData, error: lotteryError } = await supabase
        .from('lotteries')
        .select('*')
        .eq('id', lotteryId)
        .single();

      if (lotteryError) throw lotteryError;

      // 获取用户的参与记录（lottery_entries表）
      const { data: entriesData, error: entriesError } = await supabase
        .from('lottery_entries')
        .select('id, numbers, created_at, is_winning')
        .eq('lottery_id', lotteryId)
        .eq('user_id', user.id)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true })
        .limit(200);

      if (entriesError) throw entriesError;

      setLottery({
        id: lotteryData.id,
        period: lotteryData.period || lotteryData.id.slice(0, 8),
        title: lotteryData.title,
        image_url: lotteryData.image_url,
        ticket_price: lotteryData.ticket_price,
        total_tickets: lotteryData.total_tickets,
        sold_tickets: lotteryData.sold_tickets,
        status: lotteryData.status,
        winning_numbers: (lotteryData.winning_numbers as unknown) as string[] | undefined,
        winning_user_id: lotteryData.winning_user_id,
      });

      setTickets(entriesData?.map(entry => ({
        id: entry.id,
        numbers: entry.numbers as string, // 7位数处理订单码
        created_at: entry.created_at,
        is_winning: entry.is_winning || false,
      })) || []);

    } catch (error) {
      console.error('Failed to load tickets:', error);
      toast.error(t('error.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [lotteryId, user?.id, t]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const copyCode = async (code: string) => {
    const success = await copyToClipboard(code);
    if (success) {
      toast.success(t('lottery.winningCodeCopied'));
    } else {
      toast.error(t('common.copyFailed'));
    }
  };

  // 格式化7位数处理订单码显示
  const formatWinningCode = (code: string) => {
    // 确保是7位数
    return code.padStart(7, '0');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!lottery) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">{t('myTickets.lotteryNotFound')}</p>
      </div>
    );
  }

  const hasWinning = tickets.some(t => t.is_winning);
  const winningCode = lottery.winning_numbers?.[0] || '';

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* 头部 */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center space-x-4">
          <button
            onClick={() => navigate(`/lottery/${lotteryId}`)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold flex-1">{t('myTickets.title')}</h1>
          <TicketIcon className="w-6 h-6 text-primary" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* 商城信息卡片 */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="flex space-x-4">
            <div style={{ position: 'relative', width: '96px', height: '96px', flexShrink: 0, borderRadius: '0.75rem', overflow: 'hidden' }}>
              <LazyImage
                src={lottery.image_url}
                alt={lottery.title}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 text-xs text-gray-500 mb-1">
                <span>{t('myTickets.period')}: {lottery.period}</span>
              </div>
              <h2 className="text-lg font-bold mb-2">{lottery.title}</h2>
              <div className="flex items-center space-x-4 text-sm">
                <span className="text-gray-600">
                  {t('myTickets.ticketPrice')}: <span className="font-semibold text-primary">TJS{lottery.ticket_price.toFixed(2)}</span>
                </span>
                <span className="text-gray-600">
                  {t('myTickets.progress')}: <span className="font-semibold">{lottery.sold_tickets}/{lottery.total_tickets}</span>
                </span>
              </div>
            </div>
          </div>

          {lottery.status === 'COMPLETED' && winningCode && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl">
                <div className="flex items-center space-x-3">
                  <TrophyIcon className="w-6 h-6 text-yellow-600" />
                  <div>
                    <p className="text-xs text-gray-600">{t('myTickets.winningCode')}</p>
                    <p className="text-lg font-bold text-yellow-700 font-mono">{formatWinningCode(winningCode)}</p>
                  </div>
                </div>
                {hasWinning && (
                  <div className="flex items-center space-x-2 text-green-600">
                    <CheckCircleIcon className="w-5 h-5" />
                    <span className="text-sm font-medium">{t('myTickets.congratsWin')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 统计信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-primary">{tickets.length}</p>
            <p className="text-sm text-gray-600 mt-1">{t('myTickets.myEntries')}</p>
          </div>
          <div className="bg-white rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{tickets.filter(t => t.is_winning).length}</p>
            <p className="text-sm text-gray-600 mt-1">{t('myTickets.winCount')}</p>
          </div>
        </div>

        {/* 参与码列表 */}
        <div className="space-y-3">
          <h3 className="text-lg font-bold px-2">{t('myTickets.entryList')}</h3>
          {tickets.map((ticket, index) => (
            <motion.div
              key={ticket.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`bg-white rounded-xl p-4 shadow-sm ${
                ticket.is_winning ? 'ring-2 ring-yellow-400' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <TicketIcon className={`w-5 h-5 ${ticket.is_winning ? 'text-yellow-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-mono font-bold ${
                      ticket.is_winning ? 'text-yellow-700' : 'text-gray-900'
                    }`}>
                      {formatWinningCode(ticket.numbers)}
                    </span>
                    {ticket.is_winning && (
                      <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
                        {t('myTickets.won')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    <ClockIcon className="w-4 h-4" />
                    <span>{formatDateTime(ticket.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => copyCode(ticket.numbers)}
                  className="px-4 py-2 bg-amber-50 text-primary rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors"
                >
                  {t('common.copy')}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {tickets.length === 0 && (
          <div className="text-center py-12">
            <picture>
              <source srcSet="/brand/empty_cart.webp" type="image/webp" />
              <img 
                src="/brand/empty_cart.png" 
                alt="No tickets"
                className="w-36 h-36 mx-auto mb-4 opacity-80"
                style={{ objectFit: 'contain' }}
              />
            </picture>
            <p className="text-gray-500">{t('myTickets.noTickets')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyTicketsPage;
