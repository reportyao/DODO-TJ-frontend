import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useUser } from '../../contexts/UserContext';
import {
  Trophy,
  Users,
  Clock,
  ChevronLeft,
  CheckCircle,
  XCircle,
  Sparkles,
  Gift,
  MapPin,
  Ticket,
  AlertTriangle,
  RefreshCw,
  Coins,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import toast from 'react-hot-toast';
import { extractEdgeFunctionError } from '../../utils/edgeFunctionHelper'
// getOptimizedImageUrl removed to fix thumbnail enlargement issue

interface GroupBuyResult {
  id?: string;
  session_id: string;
  status: string; // 'SUCCESS', 'TIMEOUT', 'ACTIVE'
  winner_id?: string;
  winner_username?: string | null;
  created_at?: string;
  timestamp_sum?: number;
  winning_index?: number;
  pickup_status?: string;
  pickup_code?: string;
  pickup_point_id?: string;
  expires_at?: string;
  claimed_at?: string;
  pickup_point?: {
    id: string;
    name: string;
    name_i18n: { zh?: string; ru?: string; tg?: string };
    address: string;
    address_i18n: { zh?: string; ru?: string; tg?: string };
    contact_phone?: string;
    is_active: boolean;
  };
  session?: {
    id: string;
    session_code: string;
    product_id: string;
    current_participants: number;
    max_participants: number;
    status: string;
    expires_at: string;
  };
  product?: {
    id: string;
    title: { zh: string; ru: string; tg: string };
    image_url: string;
    original_price: number;
    price_per_person: number;
  };
  participants?: Array<{
    user_id: string;
    username: string;
    avatar_url?: string;
    order_number: string;
    order_timestamp?: number;
    status?: string;
    created_at: string;
  }>;
  orders?: Array<{
    id: string;
    user_id: string;
    amount: number;
    status: string;
    refund_amount?: number;
    refund_lucky_coins?: number;
    refunded_at?: string;
  }>;
  message?: string;
}

interface PickupPoint {
  id: string;
  name: string;
  name_i18n: any;
  address: string;
  address_i18n: any;
  contact_phone?: string;
  status: string;
}

export default function GroupBuyResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, sessionToken } = useUser();
  const [result, setResult] = useState<GroupBuyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isWinner, setIsWinner] = useState(false);
  const [isParticipant, setIsParticipant] = useState(false);
  const [userOrder, setUserOrder] = useState<any>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [pickupPoints, setPickupPoints] = useState<PickupPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (sessionId) {
      fetchResult();
    }
  }, [sessionId]);

  useEffect(() => {
    if (result && user) {
      // 检查当前用户是否是中奖者
      if (result.winner_id === user.id) {
        setIsWinner(true);
        // Trigger confetti animation only if not already claimed
        if (!result.pickup_code) {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });
        }
      }
      
      // 检查当前用户是否是参与者
      const participants = result.participants || [];
      const orders = result.orders || [];
      const userParticipant = participants.find(p => 
        p.user_id === user.id
      );
      const userOrderData = orders.find(o => 
        o.user_id === user.id
      );
      
      if (userParticipant || userOrderData) {
        setIsParticipant(true);
        setUserOrder(userOrderData);
      }
    }
  }, [result, user]);

  const fetchResult = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('group-buy-list', {
        body: { type: 'session-result', session_id: sessionId },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));
      if (data?.success) {
        setResult(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch result:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPickupPoints = async () => {
    try {
      const { data, error } = await supabase
        .from('pickup_points')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true });

      if (!error && data) {
        setPickupPoints(data);
        if (data.length > 0) {
          setSelectedPointId(data[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to load pickup points:', error);
    }
  };

  const handleClaimPrize = async () => {
    if (!result || !sessionToken || !selectedPointId) return;

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('claim-prize', {
        body: {
          session_token: sessionToken,
          prize_id: result.id,
          order_type: 'group_buy',
          pickup_point_id: selectedPointId,
        },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      if (data?.success) {
        toast.success(t('orders.claimSuccess'));
        setShowClaimModal(false);
        // Refresh result to show pickup code
        await fetchResult();
      } else {
        throw new Error(data?.error || 'Failed to claim prize');
      }
    } catch (error: any) {
      console.error('Claim prize error:', error);
      toast.error(error.message || t('orders.claimError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openClaimModal = () => {
    loadPickupPoints();
    setShowClaimModal(true);
  };

  // 修复多语言对象渲染问题 - 2026-01-21
  const getLocalizedText = (text: any) => {
    if (!text) return '';
    if (typeof text === 'string') return text;
    if (typeof text !== 'object') return String(text);
    
    // 尝试获取当前语言的文本
    const currentLang = text[i18n.language];
    if (currentLang && typeof currentLang === 'string' && currentLang.trim()) {
      return currentLang;
    }
    
    // 按优先级fallback到其他语言
    const fallbackLangs = ['zh', 'ru', 'tg', 'en'];
    for (const lang of fallbackLangs) {
      if (text[lang] && typeof text[lang] === 'string' && text[lang].trim()) {
        return text[lang];
      }
    }
    
    // 如果所有语言都是空的，返回空字符串
    return '';
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">{t('groupBuy.noResult')}</p>
          <button
            onClick={() => navigate('/group-buy')}
            className="mt-4 text-primary hover:text-primary font-medium"
          >
            {t('groupBuy.browseProducts')}
          </button>
        </div>
      </div>
    );
  }

  // 检查是否实际上已经超时（即使后端返回的状态还是 ACTIVE）
  const isActuallyExpired = result.status === 'ACTIVE' && 
                           result.session?.expires_at && 
                           new Date(result.session.expires_at).getTime() < Date.now();

  // 【新增】超时、取消或过期未开奖的情况
  if (result.status === 'TIMEOUT' || result.status === 'CANCELLED' || result.status === 'EXPIRED' || isActuallyExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pb-20">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-500 to-gray-600 text-white p-4 rounded-b-3xl shadow-lg">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1 text-white hover:text-gray-200 shrink-0"
            >
              <ChevronLeft className="w-6 h-6" />
              {t('common.back')}
            </button>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Clock className="w-6 h-6" />
              {t('groupBuy.sessionTimeout')}
            </h1>
          </div>
        </div>

        {/* Timeout Notice */}
        <div className="p-4">
          <div className="bg-white rounded-3xl p-8 text-center shadow-lg">
            <AlertTriangle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {t('groupBuy.timeoutTitle')}
            </h2>
            <p className="text-gray-600 mb-4">
              {t('groupBuy.timeoutDescription')}
            </p>
            
            {/* 退款信息 */}
            <div className="bg-green-50 rounded-xl p-4 mt-4">
              <div className="flex items-center justify-center gap-2 text-green-700 mb-2">
                <RefreshCw className="w-5 h-5" />
                <span className="font-bold">{t('groupBuy.refundNotice')}</span>
              </div>
              <p className="text-green-600 text-sm">
                {t('groupBuy.timeoutRefundDescription')}
              </p>
            </div>
          </div>
        </div>

        {/* Product Info */}
        {result.product && (
          <div className="p-4">
            <div className="bg-white rounded-2xl shadow-md overflow-hidden">
              <img
                src={result.product.image_url}
                alt={getLocalizedText(result.product.title)}
                loading="lazy"
                style={{ width: '100%', height: '192px', objectFit: 'cover', opacity: 0.75, display: 'block', maxWidth: 'none' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="200"%3E%3Crect fill="%23f0f0f0" width="400" height="200"/%3E%3C/svg%3E';
                }}
              />
              <div className="p-4">
                <h3 className="font-bold text-lg text-gray-800 mb-2">
                  {getLocalizedText(result.product.title)}
                </h3>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>{t('groupBuy.pricePerPerson')}</span>
                  <span className="text-gray-500 font-bold">
                    TJS {result.product.price_per_person}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Session Info */}
        {result.session && (
          <div className="p-4">
            <div className="bg-white rounded-2xl shadow-md p-6">
              <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-500" />
                {t('groupBuy.sessionInfo')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('groupBuy.sessionCode')}:</span>
                  <span className="font-mono text-gray-800">{result.session.session_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('groupBuy.participants')}:</span>
                  <span className="text-gray-800">
                    {result.session.current_participants} / {result.session.max_participants}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('groupBuy.expiredAt')}:</span>
                  <span className="text-gray-800">{formatDateTime(result.session.expires_at)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="p-4 space-y-3">
          <button
            onClick={() => navigate('/group-buy')}
            className="w-full bg-gradient-to-r from-primary via-primary to-red-500 text-white py-4 rounded-2xl font-bold shadow-lg hover:shadow-xl transition-shadow"
          >
            {t('groupBuy.browseProducts')}
          </button>
          <button
            onClick={() => navigate('/wallet')}
            className="w-full bg-white text-primary py-4 rounded-2xl font-bold shadow-md hover:shadow-lg transition-shadow"
          >
            {t('wallet.checkBalance')}
          </button>
        </div>
      </div>
    );
  }

  // 【新增】会话仍在进行中
  if (result.status === 'ACTIVE') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 pb-20">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary text-white p-6 rounded-b-3xl shadow-lg">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-white hover:text-amber-100 mb-4"
          >
            <ChevronLeft className="w-6 h-6" />
            {t('common.back')}
          </button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-7 h-7" />
            {t('groupBuy.sessionInProgress')}
          </h1>
        </div>

        {/* In Progress Notice */}
        <div className="p-4">
          <div className="bg-white rounded-3xl p-8 text-center shadow-lg">
            <Clock className="w-16 h-16 text-primary mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {t('groupBuy.waitingForParticipants')}
            </h2>
            <p className="text-gray-600">
              {t('groupBuy.waitingDescription')}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 space-y-3">
          <button
            onClick={() => navigate(`/group-buy/${result.session?.product_id || result.product?.id}`)}
            className="w-full bg-gradient-to-r from-primary to-primary text-white py-4 rounded-2xl font-bold shadow-lg hover:shadow-xl transition-shadow"
          >
            {t('groupBuy.viewSession')}
          </button>
          <button
            onClick={() => navigate('/group-buy')}
            className="w-full bg-white text-primary py-4 rounded-2xl font-bold shadow-md hover:shadow-lg transition-shadow"
          >
            {t('groupBuy.browseProducts')}
          </button>
        </div>
      </div>
    );
  }

  // 已开奖的情况（SUCCESS）
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-amber-50 pb-20">
      {/* Header - 简化为返回按钮 */}
      <div className="bg-gradient-to-r from-primary via-primary to-red-500 text-white p-4 rounded-b-3xl shadow-lg">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-white hover:text-amber-100"
        >
          <ChevronLeft className="w-6 h-6" />
          {t('common.back')}
        </button>
      </div>

      {/* Winner Announcement */}
      <div className="p-4">
        {isWinner ? (
          <div className="bg-gradient-to-r from-yellow-400 to-orange-400 rounded-3xl p-8 text-center shadow-xl">
            <Sparkles className="w-16 h-16 text-white mx-auto mb-4 animate-pulse" />
            <h2 className="text-3xl font-bold text-white mb-2">
              {t('groupBuy.congratulations')}
            </h2>
            
            {/* 立即查看按钮 - 跳转到订单详情页 */}
            <button
              onClick={() => result.id ? navigate(`/order-detail/${result.id}`) : navigate('/orders')}
              className="mt-6 px-8 py-3 bg-white text-orange-500 rounded-xl font-bold shadow-lg hover:shadow-xl transition-shadow flex items-center gap-2 mx-auto text-lg"
            >
              <Gift className="w-5 h-5" />
              {t('groupBuy.viewNow')}
            </button>
          </div>
        ) : isParticipant ? (
          // 【新增】未中奖参与者的提示
          <div className="bg-white rounded-3xl p-8 text-center shadow-lg">
            <Coins className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {t('groupBuy.notWinnerTitle')}
            </h2>
            <p className="text-gray-600 mb-4">{t('groupBuy.betterLuckNextTime')}</p>
            
            {/* 积分退回提示 */}
            <div className="bg-amber-50 rounded-xl p-4 mt-4">
              <div className="flex items-center justify-center gap-2 text-primary-dark mb-2">
                <Coins className="w-5 h-5" />
                <span className="font-bold">{t('groupBuy.pointsRefundNotice')}</span>
              </div>
              <p className="text-primary text-sm">
                {t('groupBuy.pointsRefundDescription')}
              </p>
              {userOrder?.refund_lucky_coins && (
                <p className="text-primary-dark font-bold mt-2">
                  +{userOrder.refund_lucky_coins} {t('wallet.luckyCoins')}
                </p>
              )}
            </div>
            
            {/* 引导去商城 */}
            <button
              onClick={() => navigate('/lottery')}
              className="mt-4 px-6 py-3 bg-gradient-to-r from-primary to-primary text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-shadow"
            >
              {t('groupBuy.goToPointsMall')}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-3xl p-8 text-center shadow-lg">
            <Trophy className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {t('groupBuy.drawCompleted')}
            </h2>
            <p className="text-gray-600">{t('groupBuy.viewResultDetails')}</p>
          </div>
        )}
      </div>

      {/* Pickup Point Info (if claimed) - 只显示启用的自提点 */}
      {isWinner && result.pickup_point && result.pickup_point.is_active && result.pickup_status === 'PENDING_PICKUP' && (
        <div className="p-4">
          <div className="bg-white rounded-2xl shadow-md p-4">
            <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              {t('orders.pickupPointInfo')}
            </h3>
            <div className="bg-amber-50 rounded-xl p-4">
              <p className="font-medium text-gray-800">
                {getLocalizedText(result.pickup_point.name_i18n) || result.pickup_point.name}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {getLocalizedText(result.pickup_point.address_i18n) || result.pickup_point.address}
              </p>
              {result.pickup_point.contact_phone && (
                <a
                  href={`tel:${result.pickup_point.contact_phone}`}
                  className="text-sm text-primary hover:underline mt-1 inline-block"
                >
                  {result.pickup_point.contact_phone}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Product Info */}
      {result.product && (
        <div className="p-4">
          <div className="bg-white rounded-2xl shadow-md overflow-hidden">
            <img
              src={result.product.image_url}
              alt={getLocalizedText(result.product.title)}
              loading="lazy"
              style={{ width: '100%', height: '192px', objectFit: 'cover', display: 'block', maxWidth: 'none' }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="200"%3E%3Crect fill="%23f0f0f0" width="400" height="200"/%3E%3C/svg%3E';
              }}
            />
            <div className="p-4">
              <h3 className="font-bold text-lg text-gray-800 mb-2">
                {getLocalizedText(result.product.title)}
              </h3>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{t('groupBuy.pricePerPerson')}</span>
                <span className="text-primary font-bold">
                  TJS {result.product.price_per_person}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Winner Info */}
      <div className="p-4">
        <div className="bg-white rounded-2xl shadow-md p-6">
          <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            {t('groupBuy.winner')}
          </h3>
          <div className="flex items-center gap-4 bg-yellow-50 rounded-xl p-4">
            <div className="w-12 h-12 bg-yellow-400 rounded-full flex items-center justify-center">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800">{result.winner_username || 'Winner'}</p>
              {result.created_at && (
                <p className="text-sm text-gray-600">
                  {t('groupBuy.drawTime')}: {formatDateTime(result.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* All Participants */}
      {result.participants && result.participants.length > 0 && (
        <div className="p-4">
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              {t('groupBuy.allParticipants')}
            </h3>
            <div className="space-y-3">
              {result.participants.map((participant, index) => (
                <div
                  key={participant.order_number || index}
                  className={`flex items-center gap-4 p-3 rounded-xl ${
                    participant.user_id === result.winner_id
                      ? 'bg-yellow-50 border-2 border-yellow-400'
                      : 'bg-gray-50'
                  }`}
                >
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <span className="font-bold text-primary">{index + 1}</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{participant.username}</p>
                    <p className="text-xs text-gray-500">
                      {formatDateTime(participant.created_at)}
                    </p>
                  </div>
                  {participant.user_id === result.winner_id && (
                    <CheckCircle className="w-6 h-6 text-yellow-500" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Verification Data */}
      {result.timestamp_sum && result.session && (
        <div className="p-4">
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h3 className="font-bold text-lg text-gray-800 mb-4">
              {t('groupBuy.verificationTitle')}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{t('groupBuy.timestampSum')}:</span>
                <span className="font-mono text-gray-800">{result.timestamp_sum}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">{t('groupBuy.verificationFormula')}:</span>
                <span className="font-mono text-gray-800">
                  {result.timestamp_sum} % {result.session.max_participants} = {result.winning_index}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 底部按钮已移除，中奖者通过卡片内的“立即查看”按钮跳转 */}

      {/* Claim Modal */}
      {showClaimModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg animate-slide-up">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h3 className="text-lg font-bold">{t('orders.confirmClaim')}</h3>
              <button
                onClick={() => setShowClaimModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {result.product && (
                <div className="bg-gradient-to-r from-amber-50 to-amber-50 rounded-xl p-4">
                  <div className="flex items-center space-x-3 mb-2">
                    <Gift className="w-6 h-6 text-primary" />
                    <h4 className="font-bold text-gray-800">
                      {getLocalizedText(result.product.title)}
                    </h4>
                  </div>
                  <p className="text-sm text-gray-600">{t('orders.claimDescription')}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('orders.selectPickupPoint')} *
                </label>
                {pickupPoints.length > 0 ? (
                  <select
                    value={selectedPointId}
                    onChange={(e) => setSelectedPointId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  >
                    {pickupPoints.map((point) => (
                      <option key={point.id} value={point.id}>
                        {getLocalizedText(point.name_i18n) || point.name} - {getLocalizedText(point.address_i18n) || point.address}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-center py-4 text-gray-500">
                    {t('orders.noPickupPoints')}
                  </div>
                )}
              </div>

              <div className="bg-amber-50 rounded-xl p-4 text-sm text-primary-dark">
                <p className="font-medium mb-1">{t('orders.claimNotice')}</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>{t('orders.claimNotice1')}</li>
                  <li>{t('orders.claimNotice2')}</li>
                  <li>{t('orders.claimNotice3')}</li>
                </ul>
              </div>

              <div className="pt-4 flex space-x-3">
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleClaimPrize}
                  disabled={isSubmitting || !selectedPointId || pickupPoints.length === 0}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-primary to-primary text-white rounded-xl font-medium hover:from-primary-dark hover:to-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? t('common.submitting') : t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
