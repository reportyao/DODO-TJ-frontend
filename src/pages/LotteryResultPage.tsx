import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  TrophyIcon,
  ArrowLeftIcon,
  UserGroupIcon,
  TicketIcon,
  SparklesIcon,
  CheckCircleIcon,
  XCircleIcon,
  GiftIcon,
  MapPinIcon
} from '@heroicons/react/24/outline';
import { formatDateTime, getLocalizedText } from '../lib/utils';
import toast from 'react-hot-toast';
import { useSupabase } from '@/contexts/SupabaseContext';
import { useUser } from '@/contexts/UserContext';
import { Tables } from '@/types/supabase';
import { CountdownTimer } from '../components/CountdownTimer';
import { lotteryService } from '@/lib/supabase';
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

type Lottery = Tables<'lotteries'>;
type Ticket = Tables<'tickets'>;
type User = Tables<'users'>;

interface ParticipantWithTickets {
  user: User;
  tickets: number[];
  ticketCount: number;
}

interface PrizeInfo {
  id: string;
  pickup_code?: string;
  pickup_status?: string;
  expires_at?: string;
  pickup_point?: {
    name: string;
    name_i18n: any;
    address: string;
    address_i18n: any;
    contact_phone?: string;
    is_active: boolean;
  };
  picked_up_at?: string;
}

// 转换为用户本地时间
function toLocalTime(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  
  // 使用用户本地时区显示时间
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const LotteryResultPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { supabase } = useSupabase();
  const { user: currentUser, sessionToken } = useUser();
  
  const [lottery, setLottery] = useState<Lottery | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [participants, setParticipants] = useState<ParticipantWithTickets[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // 领取相关状态
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [prizeInfo, setPrizeInfo] = useState<PrizeInfo | null>(null);
  const [pickupPoints, setPickupPoints] = useState<any[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingPrizeInfo, setIsLoadingPrizeInfo] = useState(false);
  const [isLoadingPickupPoints, setIsLoadingPickupPoints] = useState(false);

  // 获取本地化文本
  const getLocalText = (text: any): string => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    return text[i18n.language] || text.zh || text.ru || text.tg || '';
  };

  // 获取商城信息
  const fetchLottery = useCallback(async () => {
    if (!id) return;
    
    try {
      const { data, error } = await supabase
        .from('lotteries')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setLottery(data);
    } catch (error: any) {
      console.error('Failed to fetch lottery:', error);
      toast.error(t('error.networkError'));
    }
  }, [id, supabase, t]);

  // 获取所有票据和参与用户 (支持 tickets 表和 lottery_entries 表)
  const fetchTicketsAndParticipants = useCallback(async () => {
    if (!id) return;

    try {
      // 从 lottery_entries 表获取参与记录（统一使用此表）
      const { data: entriesData, error: entriesError } = await supabase
        .from('lottery_entries')
        .select('*')
        .eq('lottery_id', id)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true })
        .limit(500);

      if (entriesError) throw entriesError;

      // 转换为统一格式
      const combinedTickets = (entriesData || []).map(e => {
        // 使用 participation_code 字段（7位数参与码）
        const entry = e as any; // 类型断言以访问 participation_code 字段
        let participationCode: string;
        if (typeof entry.participation_code === 'string') {
          participationCode = entry.participation_code;
        } else {
          participationCode = String(entry.participation_code || '0000000');
        }
        
        return {
          id: e.id,
          user_id: e.user_id,
          lottery_id: e.lottery_id,
          ticket_number: parseInt(participationCode) || 0, // 转换为数字用于显示
          participation_code: participationCode, // 保留原始字符串
          is_winning: e.is_winning,
          created_at: e.created_at
        };
      });

      setTickets(combinedTickets as any || []);

      // 获取所有参与用户
      const userIds = [...new Set(combinedTickets?.map(t => t.user_id) || [])];
      
      if (userIds.length > 0) {
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('*')
          .in('id', userIds)
          .limit(500);

        if (usersError) throw usersError;

        // 组织参与者数据
        const participantsMap: { [key: string]: ParticipantWithTickets } = {};
        
        combinedTickets?.forEach(ticket => {
          const user = usersData?.find(u => u.id === ticket.user_id);
          if (!user) return;

          if (!participantsMap[user.id]) {
            participantsMap[user.id] = {
              user,
              tickets: [],
              ticketCount: 0
            };
          }

          participantsMap[user.id].tickets.push(ticket.ticket_number);
          participantsMap[user.id].ticketCount++;
        });

        setParticipants(Object.values(participantsMap));
      }
    } catch (error: any) {
      console.error('Failed to fetch tickets:', error);
    }
  }, [id, supabase]);
  
  // 获取奖品信息
  const fetchPrizeInfo = useCallback(async () => {
    if (!id || !currentUser?.id) return;
    
    setIsLoadingPrizeInfo(true);
    try {
      const { data: prizesData, error } = await supabase
        .from('prizes')
        .select(`
          id,
          pickup_code,
          pickup_status,
          expires_at,
          pickup_point_id,
          picked_up_at
        `)
        .eq('lottery_id', id)
        .eq('user_id', currentUser.id)
        .maybeSingle(); // 使用maybeSingle()而不是single()，允许没有记录

      const data = prizesData;

      if (!error && data) {
        // 如果有自提点ID，获取自提点信息
        let pickupPoint = null;
        if (data.pickup_point_id) {
          const { data: pointData } = await supabase
            .from('pickup_points')
            .select('id, name, name_i18n, address, address_i18n, contact_phone')
            .eq('id', data.pickup_point_id)
            .single();
          pickupPoint = pointData;
        }
        setPrizeInfo({
          id: data.id,
          pickup_code: data.pickup_code || undefined,
          pickup_status: data.pickup_status || undefined,
          expires_at: data.expires_at || undefined,
          pickup_point: pickupPoint,
          picked_up_at: (data as any).picked_up_at || undefined
        });
      }
    } catch (error) {
      console.error('Failed to fetch prize info:', error);
    } finally {
      setIsLoadingPrizeInfo(false);
    }
  }, [id, currentUser, supabase]);

  // 加载自提点列表
  const loadPickupPoints = useCallback(async () => {
    setIsLoadingPickupPoints(true);
    try {
      const { data, error } = await supabase
        .from('pickup_points')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true })
        .limit(50);

      if (!error && data) {
        setPickupPoints(data);
        if (data.length > 0) {
          setSelectedPointId(data[0].id);
        }
      }
    } finally {
      setIsLoadingPickupPoints(false);
    }
  }, [supabase]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchLottery(), fetchTicketsAndParticipants()]);
      setIsLoading(false);
    };

    loadData();
  }, [fetchLottery, fetchTicketsAndParticipants]);

  // 当确认是获奖用户时，获取奖品信息
  useEffect(() => {
    if (lottery?.winning_user_id === currentUser?.id) {
      fetchPrizeInfo();
      loadPickupPoints();
    }
  }, [lottery, currentUser, fetchPrizeInfo, loadPickupPoints]);

  // 倒计时结束后执行处理订单
  const handleDrawLottery = async () => {
    if (!id) return;

    setIsDrawing(true);
    try {
      // 调用 Edge Function 进行处理订单，而不是直接调用 RPC
      const { data, error } = await supabase.functions.invoke('auto-lottery-draw', {
        body: { lotteryId: id }
      });
      
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Draw failed');
      }
      
      // 刷新数据
      await fetchLottery();
      toast.success(t('lottery.drawSuccess'));
    } catch (error: any) {
      console.error('Draw failed:', error);
      toast.error(t('lottery.drawFailed'));
      
      // 即使失败也刷新，可能已经处理订单了
      await fetchLottery();
    } finally {
      setIsDrawing(false);
    }
  };

  // 点击领取按钮
  const handleClaimPrize = () => {
    
    // 如果已经领取过，直接跳转到订单管理页面
    if (prizeInfo?.pickup_code) {
      navigate('/orders');
      return;
    }
    
    // 检查是否还在加载中
    if (isLoadingPrizeInfo || isLoadingPickupPoints) {
      toast.error(t('common.loading'));
      return;
    }
    
    // 修复: 如果 prizeInfo 不存在，说明是首次领取，允许继续
    // 只有当 prizeInfo 存在且没有 pickup_code 时才需要领取
    // 或者 prizeInfo 不存在时也允许领取
    
    // 检查是否有可用的自提点
    if (pickupPoints.length === 0) {
      toast.error(t('orders.noPickupPoints'));
      console.error('[ClaimPrize] No pickup points available');
      return;
    }
    
    setShowClaimModal(true);
  };

  // 提交领取请求
  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || !id) return;

    setIsSubmitting(true);
    try {
      // 修复: 如果 prizeInfo 存在就使用 prize_id，否则使用 lottery_id
      const requestBody: any = {
        session_token: sessionToken,
        order_type: 'lottery',
        pickup_point_id: selectedPointId,
      };
      
      if (prizeInfo?.id) {
        requestBody.prize_id = prizeInfo.id;
      } else {
        requestBody.lottery_id = id;
      }
      
      const { data, error } = await supabase.functions.invoke('claim-prize', {
        body: requestBody
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      const result = data as { success: boolean; error?: string; data?: any };

      if (!result.success) {
        throw new Error(result.error || 'Failed to claim prize');
      }

      toast.success(t('orders.claimSuccess'));
      setShowClaimModal(false);
      
      // 刷新奖品信息
      await fetchPrizeInfo();
      
      // 跳转到订单管理页面
      navigate('/orders');
    } catch (error: any) {
      console.error('Claim prize error:', error);
      toast.error(error.message || t('orders.claimError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-amber-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">{t('common.loading')}...</p>
        </div>
      </div>
    );
  }

  if (!lottery) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">{t('lottery.notFound')}</p>
          <button
            onClick={() => navigate('/lottery')}
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark"
          >
            {t('lottery.backToHall')}
          </button>
        </div>
      </div>
    );
  }

  const isSoldOut = lottery.status === 'SOLD_OUT';
  const isCompleted = lottery.status === 'COMPLETED';
  // 获取获奖号码 - 优先使用 winning_numbers 数组中的7位数处理订单码
  const winningTicketNumber = lottery.winning_numbers?.[0] 
    ? (typeof lottery.winning_numbers[0] === 'string' 
        ? parseInt(lottery.winning_numbers[0]) 
        : lottery.winning_numbers[0])
    : lottery.winning_ticket_number;
  const winningTicket = tickets.find(t => t.ticket_number === winningTicketNumber);
  const winningUser = participants.find(p => p.user.id === lottery.winning_user_id);
  const isCurrentUserWinner = currentUser?.id === lottery.winning_user_id;
  const myTickets = tickets.filter(t => t.user_id === currentUser?.id);

  // 判断是否需要领取 - 修复: 即使 prizeInfo 不存在，只要是获奖用户且没有领取码，就显示按钮
  const needsClaim = isCurrentUserWinner && (!prizeInfo || !prizeInfo.pickup_code);
  const hasClaimed = isCurrentUserWinner && prizeInfo?.pickup_code;
  const isPickedUp = prizeInfo?.pickup_status === 'PICKED_UP' || prizeInfo?.picked_up_at;
  
  // 计算剩余时间
  const getRemainingTime = () => {
    if (!prizeInfo?.expires_at) return null;
    const now = new Date();
    const expiresAt = new Date(prizeInfo.expires_at);
    const diffMs = expiresAt.getTime() - now.getTime();
    if (diffMs <= 0) return { expired: true, days: 0, hours: 0 };
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return { expired: false, days, hours };
  };
  const remainingTime = getRemainingTime();

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-amber-50 to-amber-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary-dark text-white px-4 py-3 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            onClick={() => navigate('/lottery')}
            className="p-2 hover:bg-white/20 rounded-full transition"
          >
            <ArrowLeftIcon className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SparklesIcon className="w-6 h-6" />
            {isCompleted ? t('lottery.drawResult') : t('lottery.drawingPage')}
          </h1>
          <div className="w-10"></div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* 商城信息卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-lg p-6"
        >
          <div className="flex items-start gap-4">
            <img
              src={lottery.image_url || '/placeholder.png'}
              alt={getLocalizedText(lottery.title_i18n, 'zh')}
              loading="lazy"
              style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '0.75rem', flexShrink: 0, maxWidth: 'none' }}
            />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                {getLocalizedText(lottery.title_i18n, 'zh')}
              </h2>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <TicketIcon className="w-4 h-4" />
                  {t('lottery.period')}: {lottery.period}
                </span>
                <span className="flex items-center gap-1">
                  <UserGroupIcon className="w-4 h-4" />
                  {participants.length} {t('lottery.participants')}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 处理倒计时 */}
        {isSoldOut && lottery.draw_time && !isCompleted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 rounded-2xl shadow-lg p-8 text-center text-white"
          >
            <h3 className="text-2xl font-bold mb-4">{t('lottery.drawingCountdown')}</h3>
            <CountdownTimer 
              drawTime={lottery.draw_time} 
              onCountdownEnd={handleDrawLottery}
            />
            {isDrawing && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>{t('lottery.drawing')}</span>
              </div>
            )}
          </motion.div>
        )}

        {/* 获奖结果 */}
        {isCompleted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-2xl shadow-lg p-8 text-center ${
              isCurrentUserWinner 
                ? 'bg-gradient-to-br from-yellow-400 via-orange-400 to-red-400 text-white' 
                : 'bg-white'
            }`}
          >
            <div className="mb-6">
              {isCurrentUserWinner ? (
                <TrophyIcon className="w-20 h-20 mx-auto text-white animate-bounce" />
              ) : (
                <CheckCircleIcon className="w-20 h-20 mx-auto text-green-500" />
              )}
            </div>

            <h3 className={`text-2xl font-bold mb-4 ${isCurrentUserWinner ? 'text-white' : 'text-gray-900'}`}>
              {isCurrentUserWinner ? t('lottery.youWon') : t('lottery.drawCompleted')}
            </h3>

            {/* 获奖号码 */}
            <div className={`inline-block px-6 py-3 rounded-xl mb-6 ${
              isCurrentUserWinner ? 'bg-white/20' : 'bg-gradient-to-r from-yellow-100 to-orange-100'
            }`}>
              <p className={`text-sm ${isCurrentUserWinner ? 'text-white/70' : 'text-gray-600'}`}>
                {t('lottery.winningNumber')}
              </p>
              <p className={`text-3xl font-bold font-mono ${isCurrentUserWinner ? 'text-white' : 'text-orange-600'}`}>
                {String(winningTicketNumber).padStart(7, '0')}
              </p>
            </div>

            {/* 获奖用户 */}
            <div className="flex items-center justify-center gap-3 mb-4">
              {winningUser && (
                <div className={`flex items-center gap-3 px-4 py-2 rounded-xl ${
                  isCurrentUserWinner ? 'bg-white/20' : 'bg-gray-100'
                }`}>
                  <img
                    src={winningUser.user.avatar_url || '/default-avatar.png'}
                    alt={winningUser.user.first_name || 'Winner'}
                    style={{ width: '48px', height: '48px', borderRadius: '9999px', border: '4px solid white', objectFit: 'cover', maxWidth: 'none' }}
                  />
                  <div className={`text-left ${isCurrentUserWinner ? 'text-white' : 'text-gray-900'}`}>
                    <p className="font-semibold">
                      {winningUser.user.first_name || winningUser.user.id?.slice(0, 8)}
                    </p>
                    <p className={`text-sm ${isCurrentUserWinner ? 'text-white/70' : 'text-gray-600'}`}>
                      {t('lottery.winner')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {lottery.draw_time && (
              <p className={`text-sm ${isCurrentUserWinner ? 'text-white/70' : 'text-gray-500'}`}>
                {t('lottery.drawTime')}: {toLocalTime(lottery.draw_time)}
              </p>
            )}
            
            {/* 获奖用户的领取按钮 */}
            {isCurrentUserWinner && (
              <div className="mt-6">
                {isPickedUp ? (
                  // 已核销取货状态
                  <div className="space-y-3">
                    <div className="bg-green-500/30 rounded-xl p-4 border border-green-300">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircleIcon className="w-6 h-6 text-green-200" />
                        <p className="text-lg font-bold text-white">{t('orders.alreadyPickedUp')}</p>
                      </div>
                      <p className="text-sm text-white/80">{t('orders.pickedUpSuccess')}</p>
                      {prizeInfo?.picked_up_at && (
                        <p className="text-xs text-white/60 mt-2">
                          {t('orders.pickedUpAt')}: {toLocalTime(prizeInfo.picked_up_at)}
                        </p>
                      )}
                    </div>
                  </div>
                ) : needsClaim ? (
                  <button
                    onClick={handleClaimPrize}
                    className="w-full bg-white text-orange-500 font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <GiftIcon className="w-6 h-6" />
                    {t('orders.claimNow')}
                  </button>
                ) : hasClaimed ? (
                  <div className="space-y-3">
                    {/* 提货码 */}
                    <div className="bg-white/20 rounded-xl p-4">
                      <p className="text-sm text-white/80 mb-1">{t('orders.pickupCode')}</p>
                      <p className="text-3xl font-bold font-mono text-white">{prizeInfo?.pickup_code}</p>
                    </div>
                    
                    {/* 自提点地址 - 只显示启用的自提点 */}
                    {prizeInfo?.pickup_point && prizeInfo.pickup_point.is_active && (
                      <div className="bg-white/10 rounded-xl p-4">
                        <div className="flex items-start gap-2">
                          <MapPinIcon className="w-5 h-5 text-white/80 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm text-white/80 mb-1">{t('orders.pickupPointAddress')}</p>
                            <p className="text-white font-medium">
                              {getLocalText(prizeInfo.pickup_point.name_i18n) || prizeInfo.pickup_point.name}
                            </p>
                            <p className="text-sm text-white/70 mt-1">
                              {getLocalText(prizeInfo.pickup_point.address_i18n) || prizeInfo.pickup_point.address}
                            </p>
                            {prizeInfo.pickup_point.contact_phone && (
                              <p className="text-sm text-white/70 mt-1">
                                {t('orders.pickupPointPhone')}: {prizeInfo.pickup_point.contact_phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* 剩余时间 */}
                    {remainingTime && (
                      <div className="bg-white/10 rounded-xl p-3">
                        <p className="text-sm text-white/80">
                          {remainingTime.expired ? (
                            <span className="text-red-300">{t('orders.expired')}</span>
                          ) : (
                            <>
                              {t('orders.expiresIn')}: 
                              <span className="font-bold text-white ml-1">
                                {remainingTime.days} {t('orders.days')} {remainingTime.hours} {t('orders.hours')}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    )}
                    
                    <button
                      onClick={() => navigate('/orders')}
                      className="w-full bg-white text-orange-500 font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                    >
                      {t('orders.title')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleClaimPrize}
                    className="w-full bg-white text-orange-500 font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <TrophyIcon className="w-6 h-6" />
                    {t('orders.claimNow')}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* 参与用户 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl shadow-lg p-6"
        >
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <UserGroupIcon className="w-5 h-5" />
            {t('lottery.allParticipants')} ({participants.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {participants.map((participant) => (
              <div
                key={participant.user.id}
                className="flex flex-col items-center"
              >
                <div className="relative">
                  <img
                    src={participant.user.avatar_url || '/default-avatar.png'}
                    alt={participant.user.first_name || 'User'}
                    style={{ width: '32px', height: '32px', borderRadius: '9999px', objectFit: 'cover', maxWidth: 'none', ...(participant.user.id === lottery.winning_user_id ? { boxShadow: '0 0 0 2px #facc15' } : {}) }}
                  />
                  {participant.user.id === lottery.winning_user_id && (
                    <TrophyIcon className="w-4 h-4 text-yellow-500 absolute -top-1 -right-1 bg-white rounded-full p-0.5" />
                  )}
                </div>
                <p className="text-xs text-gray-700 text-center truncate max-w-[60px]">
                  {participant.user.first_name || participant.user.id?.slice(0, 8)}
                </p>
                <p className="text-[10px] text-gray-400">
                  {participant.ticketCount}{t('lottery.tickets')}
                </p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 所有参与码 - 移除外框，直接显示号码 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl shadow-lg p-6"
        >
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <TicketIcon className="w-5 h-5" />
            {t('lottery.allTickets')} ({tickets.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {tickets.map((ticket) => {
              const isWinning = ticket.ticket_number === winningTicketNumber;
              const isMine = ticket.user_id === currentUser?.id;
              
              return (
                <span
                  key={ticket.id}
                  className={`
                    px-3 py-1 rounded-lg font-mono text-sm font-semibold
                    ${isWinning
                      ? 'bg-gradient-to-br from-yellow-400 to-orange-400 text-white ring-2 ring-yellow-300'
                      : isMine
                      ? 'bg-amber-100 text-primary-dark'
                      : 'bg-gray-100 text-gray-700'
                    }
                  `}
                >
                  {String(ticket.ticket_number).padStart(7, '0')}
                </span>
              );
            })}
          </div>
        </motion.div>

        {/* 算法说明 & 验证数据 */}
        {isCompleted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-4"
          >
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-6">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <CheckCircleIcon className="w-5 h-5 text-green-500" />
                {t('lottery.fairnessTitle')}
              </h3>
              
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                <h4 className="font-semibold text-primary-dark mb-2 flex items-center">
                  <span className="text-primary mr-2">📊</span>
                  {t('lottery.algorithmIntro')}
                </h4>
                <p className="text-sm text-primary-dark leading-relaxed">
                  {t('lottery.algorithmDescription')}
                </p>
              </div>

              {/* 验证数据 */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-300">
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                  <span className="text-gray-600 mr-2">🔍</span>
                  {t('lottery.verificationData')}
                </h4>
                <div className="space-y-2 font-mono text-sm">
                  {(() => {
                    try {
                      let algorithmData: any = lottery.draw_algorithm_data;
                      if (typeof algorithmData === 'string') {
                        try {
                          algorithmData = JSON.parse(algorithmData);
                        } catch (e) {
                          console.error('Failed to parse algorithm data:', e);
                        }
                      }
                      
                      // 如果没有算法数据，显示不可用
                      if (!algorithmData) {
                        return (
                          <p className="text-gray-500 text-center py-2">
                            {t('lottery.verificationDataUnavailable')}
                          </p>
                        );
                      }
                      
                      const timestampSum = algorithmData.timestamp_sum || '0';
                      const totalEntries = algorithmData.total_entries || 0;
                      const winningIndex = algorithmData.winning_index;
                      const formula = algorithmData.formula;
                      
                      // 解析formula并翻译
                      let translatedFormula = formula;
                      if (formula && typeof formula === 'string') {
                        // 尝试从中文formula中提取数值
                        // 格式: "获奖索引 = {sum} % {total} = {index}，对应号码: {number}"
                        const match = formula.match(/([\d.]+)\s*%\s*([\d.]+)\s*=\s*([\d.]+)[^\d]+(\d+)/);
                        if (match) {
                          const [, sum, total, index, number] = match;
                          // 使用当前语言的模板
                          if (i18n.language === 'ru') {
                            translatedFormula = `Индекс победителя = ${sum} % ${total} = ${index}, соответствующий номер: ${number}`;
                          } else if (i18n.language === 'tg') {
                            translatedFormula = `Нишонаи баранда = ${sum} % ${total} = ${index}, рақами мувофиқ: ${number}`;
                          }
                          // 如果是中文，保持原样
                        }
                      }
                      
                      return (
                        <>
                          <div className="flex justify-between py-1 border-b border-gray-200">
                            <span className="text-gray-500">{t('lottery.totalEntries')}</span>
                            <span className="text-gray-900 font-bold">{totalEntries}</span>
                          </div>
                          <div className="flex flex-col py-1 border-b border-gray-200">
                            <span className="text-gray-500 mb-1">{t('lottery.timestampSum')}</span>
                            <span className="text-gray-900 break-all">{timestampSum}</span>
                          </div>
                          <div className="flex flex-col py-1">
                            <span className="text-gray-500 mb-1">{t('lottery.verificationFormula')}</span>
                            <span className="text-primary font-bold break-words">{translatedFormula}</span>
                          </div>
                        </>
                      );
                    } catch (e) {
                      console.error('Error rendering algorithm data:', e);
                      return (
                        <p className="text-gray-500 text-center py-2">
                          {t('lottery.verificationDataUnavailable')}
                        </p>
                      );
                    }
                  })()}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 领取弹窗 */}
      <AnimatePresence>
        {showClaimModal && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60]">
            <motion.div
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl"
            >
              {/* 头部固定 */}
              <div className="flex-none bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl z-10">
                <h3 className="text-lg font-bold">{t('orders.confirmClaim')}</h3>
                <button
                  onClick={() => setShowClaimModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* 内容区域可滚动 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="bg-gradient-to-r from-amber-50 to-amber-50 rounded-xl p-4">
                  <div className="flex items-center space-x-3 mb-2">
                    <GiftIcon className="w-6 h-6 text-primary" />
                    <h4 className="font-bold text-gray-800">{getLocalizedText(lottery.title_i18n, i18n.language)}</h4>
                  </div>
                  <p className="text-sm text-gray-600">{t('orders.claimDescription')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('orders.selectPickupPoint')} *
                  </label>
                  <select
                    value={selectedPointId}
                    onChange={(e) => setSelectedPointId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent bg-white"
                    required
                  >
                    {pickupPoints.map((point) => (
                      <option key={point.id} value={point.id}>
                        {getLocalText(point.name_i18n)} - {getLocalText(point.address_i18n)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-amber-50 rounded-xl p-4 text-sm text-primary-dark">
                  <p className="font-medium mb-1">{t('orders.claimNotice')}</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>{t('orders.claimNotice1')}</li>
                    <li>{t('orders.claimNotice2')}</li>
                    <li>{t('orders.claimNotice3')}</li>
                  </ul>
                </div>
                
                {/* 增加底部占位，确保滚动到底部时内容不被遮挡 */}
                <div className="h-24 sm:hidden"></div>
              </div>

              {/* 底部按钮固定，并增加巨大的底部内边距避开 TabBar */}
              <div className="flex-none border-t bg-white p-6 pb-24 sm:pb-6 flex space-x-3 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSubmitClaim}
                  disabled={isSubmitting}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-primary to-primary-dark text-white rounded-xl font-medium hover:from-primary-dark hover:to-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-200"
                >
                  {isSubmitting ? t('common.submitting') : t('common.confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LotteryResultPage;
