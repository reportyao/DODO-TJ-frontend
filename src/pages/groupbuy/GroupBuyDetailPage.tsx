import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useUser } from '../../contexts/UserContext';
import toast from 'react-hot-toast';
import {
  ShoppingBag,
  Users,
  Clock,
  Share2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  Crown,
  Zap,
} from 'lucide-react';
import { cn, copyToClipboard } from '../../lib/utils';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { extractEdgeFunctionError } from '../../utils/edgeFunctionHelper'
// getOptimizedImageUrl removed to fix thumbnail enlargement issue

interface PriceComparisonItem {
  platform: string;
  price: number;
}

interface GroupBuyProduct {
  id: string;
  title: { zh: string; ru: string; tg: string };
  description: { zh: string; ru: string; tg: string };
  image_url: string;
  images?: string[]; // 多图支持
  original_price: number;
  price_per_person: number;
  group_size: number;
  timeout_hours: number;
  product_type: string;
  price_comparisons?: PriceComparisonItem[];
}

interface GroupBuySession {
  id: string;
  session_code: string;
  current_participants: number;
  max_participants: number;
  expires_at: string;
  initiator_id: string;
  orders: Array<{
    id: string;
    user_id: string;
    created_at: string;
    users?: {
      id: string;
      first_name: string | null;
      phone_number: string | null;
      avatar_url: string | null;
    };
  }>;
}

// 图片轮播组件
function ImageCarousel({ images, alt }: { images: string[]; alt: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);

  // 自动播放
  useEffect(() => {
    if (!images || images.length <= 1 || !autoPlayEnabled) return;
    
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    }, 3000); // 每3秒切换

    return () => clearInterval(timer);
  }, [images, images.length, autoPlayEnabled, currentIndex]);

  if (!images || images.length === 0) {
    return (
      <div className="w-full bg-gray-200 flex items-center justify-center" style={{ height: '375px' }}>
        <span className="text-gray-400">No Image</span>
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <>
        <div 
          className="w-full bg-gray-50 flex items-center justify-center cursor-pointer"
          style={{ height: '375px' }}
          onClick={() => setIsModalOpen(true)}
        >
          <img
            src={images[0]}
            alt={alt}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', maxWidth: 'none' }}
          />
        </div>
        {/* Image Modal */}
        {isModalOpen && (
          <div 
            className="fixed inset-0 z-50 bg-black flex items-center justify-center"
            onClick={() => setIsModalOpen(false)}
          >
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors z-10"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={images[0]}
              alt={alt}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', padding: '16px', cursor: 'pointer' }}
              onClick={() => setIsModalOpen(false)}
            />
          </div>
        )}
      </>
    );
  }

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    setAutoPlayEnabled(false);
    setTimeout(() => setAutoPlayEnabled(true), 5000);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    setAutoPlayEnabled(false);
    setTimeout(() => setAutoPlayEnabled(true), 5000);
  };

  return (
    <>
      <div className="relative w-full bg-gray-50" style={{ height: '375px' }}>
        {/* Main Image */}
        <div 
          className="w-full h-full flex items-center justify-center cursor-pointer"
          onClick={() => setIsModalOpen(true)}
        >
          <img
            src={images[currentIndex]}
            alt={`${alt} - ${currentIndex + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', maxWidth: 'none' }}
          />
        </div>
        
        {/* Navigation Arrows */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPrevious();
          }}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors z-10"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors z-10"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        
        {/* Dots Indicator */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(index);
                setAutoPlayEnabled(false);
                setTimeout(() => setAutoPlayEnabled(true), 5000);
              }}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentIndex ? 'bg-white w-4' : 'bg-white/60'
              }`}
            />
          ))}
        </div>
        
        {/* Image Counter */}
        <div className="absolute top-3 right-3 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {currentIndex + 1}/{images.length}
        </div>
      </div>

      {/* Image Modal */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setIsModalOpen(false)}
        >
          <button
            onClick={() => setIsModalOpen(false)}
            className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="relative w-full h-full flex items-center justify-center p-4">
            <img
              src={images[currentIndex]}
              alt={`${alt} - ${currentIndex + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer', maxWidth: 'none' }}
              onClick={() => setIsModalOpen(false)}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 text-white p-3 rounded-full hover:bg-white/30 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 text-white p-3 rounded-full hover:bg-white/30 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/50 text-white px-4 py-2 rounded-full text-sm">
              {currentIndex + 1} / {images.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 比价清单组件
function PriceComparisonList({ comparisons, t }: { comparisons: PriceComparisonItem[]; t: any }) {
  if (!comparisons || comparisons.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-100 rounded-xl p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {t('groupBuy.priceComparison')}
      </h3>
      <div className="space-y-1">
        {comparisons.map((item, index) => (
          <div key={index} className="flex items-center text-sm">
            <X className="w-4 h-4 text-red-500 mr-2 flex-shrink-0" />
            <span className="text-gray-600">{item.platform}:</span>
            <span className="ml-2 text-gray-500">TJS {(item.price || 0).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 一键包团确认弹窗组件
function SquadBuyConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  product,
  isProcessing,
  t,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  product: GroupBuyProduct;
  isProcessing: boolean;
  t: any;
}) {
  if (!isOpen) return null;

  const groupSize = product.group_size || 3;
  const totalPrice = product.price_per_person * groupSize;
  const refundPoints = product.price_per_person * (groupSize - 1);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-200 my-auto max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          disabled={isProcessing}
        >
          <X className="w-6 h-6" />
        </button>

        {/* Title */}
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-gray-800">
            {t('groupBuy.squadBuy.confirmTitle')}
          </h2>
          <p className="text-gray-500 text-xs mt-1">
            {t('groupBuy.squadBuy.confirmSubtitle')}
          </p>
        </div>

        {/* Price Details */}
        <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">{t('groupBuy.squadBuy.originalPrice')}</span>
            <span className="line-through text-gray-400">TJS {product.original_price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">{t('groupBuy.squadBuy.pricePerPerson')}</span>
            <span className="text-gray-800 font-medium">TJS {product.price_per_person.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">{t('groupBuy.squadBuy.quantity')}</span>
            <span className="text-gray-800 font-medium">× {groupSize}</span>
          </div>
          <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
            <span className="text-gray-800 font-semibold">{t('groupBuy.squadBuy.totalPayment')}</span>
            <span className="text-xl font-bold text-orange-500">TJS {totalPrice.toFixed(2)}</span>
          </div>
        </div>

        {/* Discount Info */}
        <div className="bg-orange-50 rounded-xl px-3 py-1.5 mb-3 text-center">
          <span className="text-orange-600 text-sm font-semibold">
            {t('groupBuy.squadBuy.discountInfo', { 
              discount: ((totalPrice / product.original_price) * 100).toFixed(0) 
            })}
          </span>
        </div>

        {/* Benefits */}
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-3 mb-4">
          <p className="text-xs font-semibold text-gray-700 mb-2 text-center">
            {t('groupBuy.squadBuy.youWillGet')}
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs">✓</span>
              </div>
              <span className="text-gray-700">
                <span className="font-bold">1×</span> {t('groupBuy.squadBuy.product')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs">✓</span>
              </div>
              <span className="text-gray-700">
                <span className="font-bold text-green-600">{refundPoints.toFixed(2)}</span> {t('groupBuy.squadBuy.points')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs">✓</span>
              </div>
              <span className="text-gray-700">
                <span className="font-bold text-blue-600">{groupSize * 10}</span> {t('groupBuy.squadBuy.aiChats')}
              </span>
            </div>
          </div>
        </div>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          disabled={isProcessing}
          className="w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white py-3 rounded-xl font-bold text-base hover:from-yellow-500 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              {t('common.processing')}
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              {t('groupBuy.squadBuy.confirmButton')}
            </>
          )}
        </button>

        {/* Free Shipping Promo */}
        <p className="text-center text-xs text-gray-500 mt-3">
          {t('common.freeShippingPromo').split('0 TJS').map((part: string, i: number) => (
            <span key={i}>
              {i > 0 && <span className="font-bold text-red-500">0 TJS</span>}
              {part}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

export default function GroupBuyDetailPage() {
  const { productId: id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, wallets, refreshWallets } = useUser();
  const [product, setProduct] = useState<GroupBuyProduct | null>(null);
  const [sessions, setSessions] = useState<GroupBuySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [userParticipatedSessions, setUserParticipatedSessions] = useState<Set<string>>(new Set());
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState<boolean>(false);
  
  // 一键包团相关状态
  const [showSquadConfirm, setShowSquadConfirm] = useState(false);
  const [isSquadBuying, setIsSquadBuying] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProductAndSessions();
    }
  }, [id]);

  const fetchProductAndSessions = async () => {
    try {
      setLoading(true);

      // Fetch product using Edge Function
      const { data: productResponse, error: productError } = await supabase.functions.invoke(
        'group-buy-list',
        {
          body: { type: 'product', product_id: id },
        }
      );

      if (productError) throw productError;
      if (productResponse?.success) {
        setProduct(productResponse.data);
      }

      // Fetch active sessions using Edge Function
      const { data: sessionsResponse, error: sessionsError } = await supabase.functions.invoke(
        'group-buy-list',
        {
          body: { type: 'sessions', product_id: id },
        }
      );

      if (sessionsError) throw sessionsError;
      
      if (sessionsResponse?.success) {
        const sessionsData = sessionsResponse.data || [];
        setSessions(sessionsData);

        // 检查用户已参与的session
        if (user?.id) {
          const participatedSet = new Set<string>();
          sessionsData.forEach((session: GroupBuySession) => {
            const hasUserOrder = session.orders?.some(
              (order) => order.user_id === user.id
            );
            if (hasUserOrder) {
              participatedSet.add(session.id);
            }
          });
          setUserParticipatedSessions(participatedSet);
        }
      }
    } catch (error) {
      console.error('Error fetching product and sessions:', error);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (sessionId?: string) => {
    if (!user) {
      toast.error(t('common.pleaseLogin'));
      navigate('/auth');
      return;
    }

    if (!product) return;

    const targetSessionId = sessionId || 'new';
    setJoiningSessionId(targetSessionId);

    try {
      // Get TJS wallet
      const tjsWallet = wallets.find((w) => w.type === 'TJS');
      if (!tjsWallet) {
        toast.error(t('wallet.walletNotFound'));
        return;
      }

      // Check balance (considering frozen_balance)
      const availableBalance = Number(tjsWallet.balance) - Number(tjsWallet.frozen_balance || 0);
      if (availableBalance < product.price_per_person) {
        toast.error(t('wallet.insufficientBalance'));
        navigate('/wallet');
        return;
      }

      const { data, error } = await supabase.functions.invoke('group-buy-join', {
        body: {
          product_id: product.id,
          session_id: sessionId || null,
          user_id: user.id,
        },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      if (data?.success) {
        toast.success(t('groupBuy.joinSuccess'));
        await refreshWallets();
        
        // Navigate to result page
        if (data.data?.session_id) {
          navigate(`/group-buy/result/${data.data.session_id}`);
        } else {
          await fetchProductAndSessions();
        }
      } else {
        throw new Error(data?.error || 'Join failed');
      }
    } catch (error: any) {
      console.error('Error joining group:', error);
      toast.error(error.message || t('groupBuy.joinFailed'));
    } finally {
      setJoiningSessionId(null);
    }
  };

  // 一键包团：打开确认弹窗
  const handleSquadBuyClick = () => {
    if (!user) {
      toast.error(t('common.pleaseLogin'));
      navigate('/auth');
      return;
    }

    if (!product) return;

    // 检查用户是否已在某个进行中的session中
    if (userParticipatedSessions.size > 0) {
      toast.error(t('groupBuy.squadBuy.alreadyInSession'));
      return;
    }

    setShowSquadConfirm(true);
  };

  // 一键包团：确认支付
  const handleConfirmSquadBuy = async () => {
    if (!user || !product) return;

    setIsSquadBuying(true);

    try {
      // Get TJS wallet
      const tjsWallet = wallets.find((w) => w.type === 'TJS');
      if (!tjsWallet) {
        toast.error(t('wallet.walletNotFound'));
        setShowSquadConfirm(false);
        return;
      }

      // Check available balance (balance - frozen_balance)
      const availableBalance = Number(tjsWallet.balance) - Number(tjsWallet.frozen_balance || 0);
      const groupSize = product.group_size || 3;
      const totalPrice = product.price_per_person * groupSize;

      if (availableBalance < totalPrice) {
        toast.error(t('groupBuy.squadBuy.insufficientBalance'));
        setShowSquadConfirm(false);
        navigate('/wallet');
        return;
      }

      // Call squad-buy edge function
      const { data, error } = await supabase.functions.invoke('group-buy-squad', {
        body: {
          product_id: product.id,
          user_id: user.id,
        },
      });

      if (error) throw new Error(await extractEdgeFunctionError(error));

      if (!data?.success) {
        throw new Error(data?.error || 'Squad buy failed');
      }

      // Success
      toast.success(t('groupBuy.squadBuy.success'));
      
      // Refresh wallets
      await refreshWallets();
      
      // Close modal
      setShowSquadConfirm(false);
      
      // Navigate to result page
      if (data.data?.session_id) {
        navigate(`/group-buy/result/${data.data.session_id}`);
      }
    } catch (error: any) {
      console.error('Error in squad buy:', error);
      
      // Handle specific error types
      const errorMessage = error.message || error.error || '';
      
      if (errorMessage.includes('insufficient_balance') || errorMessage.includes('balance')) {
        toast.error(t('groupBuy.squadBuy.insufficientBalance'));
        navigate('/wallet');
      } else if (errorMessage.includes('out_of_stock') || errorMessage.includes('stock')) {
        toast.error(t('groupBuy.squadBuy.outOfStock'));
      } else if (errorMessage.includes('limit') || errorMessage.includes('quota')) {
        toast.error(t('groupBuy.squadBuy.limitExceeded'));
      } else {
        toast.error(t('groupBuy.squadBuy.failed'));
      }
      
      setShowSquadConfirm(false);
    } finally {
      setIsSquadBuying(false);
    }
  };

  const handleShare = async (sessionCode: string) => {
    const shareUrl = `${window.location.origin}/group-buy/join/${sessionCode}`;
    const shareText = t('groupBuy.shareText', { code: sessionCode });
    
    // 优先使用 Web Share API
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'TezBarakat',
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (e) {
        // 用户取消分享或不支持，回退到剪贴板
        if ((e as Error).name !== 'AbortError') {
          console.error('Share failed:', e);
        }
      }
    }
    
    // 回退：复制到剪贴板
    try {
      await copyToClipboard(`${shareText}\n${shareUrl}`);
      toast.success(t('common.copiedToClipboard'));
    } catch (error) {
      // 最终回退：WhatsApp 分享
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + shareUrl)}`;
      window.open(whatsappUrl, '_blank');
    }
  };

  const calculateTimeLeft = (expiresAt: string) => {
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const diff = expiry - now;

    if (diff <= 0) return t('groupBuy.expired');

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}${t('common.hour')} ${minutes}${t('common.minute')}`;
    }
    return `${minutes}${t('common.minute')}`;
  };

  const getLocalizedText = (text: { zh: string; ru: string; tg: string } | string): string => {
    if (typeof text === 'string') return text;
    const lang = i18n.language as 'zh' | 'ru' | 'tg';
    return text[lang] || text.zh || '';
  };

  const getProductImages = (): string[] => {
    if (!product) return [];
    if (product.images && product.images.length > 0) {
      return product.images;
    }
    if (product.image_url) {
      return [product.image_url];
    }
    return [];
  };

  const truncateUsername = (username: string | null, maxLength: number = 10): string => {
    if (!username) return 'User';
    if (username.length <= maxLength) return username;
    return username.substring(0, maxLength) + '...';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{t('groupBuy.productNotFound')}</p>
          <button
            onClick={() => navigate('/group-buy')}
            className="mt-4 text-purple-500 hover:text-purple-600"
          >
            {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white p-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-white hover:text-pink-100"
        >
          <ChevronLeft className="w-6 h-6" />
          {t('common.back')}
        </button>
      </div>

      {/* Product Image Carousel */}
      <div className="relative">
        <ImageCarousel 
          images={getProductImages()} 
          alt={getLocalizedText(product.title)} 
        />
      </div>

      {/* Product Info */}
      <div className="p-6 bg-white rounded-t-3xl -mt-6 relative z-10">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          {getLocalizedText(product.title)}
        </h1>
        {/* 商品介绍 - 智能分段 + 折叠展开 */}
        {getLocalizedText(product.description) && (
          <div className="space-y-2 mb-4">
            <div className={cn(
              "text-gray-600 leading-relaxed whitespace-pre-line",
              !isDescriptionExpanded && "line-clamp-3"
            )}>
              {/* 智能分段：将文本按句号分段 */}
              {getLocalizedText(product.description).split(/(?<=[.。!！?？])\s+/).map((paragraph: string, index: number) => (
                <p key={index} className="mb-2 last:mb-0">{paragraph.trim()}</p>
              ))}
            </div>
            {/* 展开/收起按钮 */}
            {getLocalizedText(product.description).length > 100 && (
              <button
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className="text-blue-600 text-sm font-medium hover:text-blue-700 transition-colors flex items-center gap-1"
              >
                {isDescriptionExpanded ? (
                  <>
                    <span>{t('common.collapse')}</span>
                    <ChevronRightIcon className="w-4 h-4 transform rotate-90" />
                  </>
                ) : (
                  <>
                    <span>{t('common.expandMore')}</span>
                    <ChevronRightIcon className="w-4 h-4 transform -rotate-90" />
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Price */}
        <div className="bg-purple-50 rounded-2xl p-4 mb-4">
          <div className="flex items-end gap-2 mb-2">
            <div className="text-purple-600 font-bold text-3xl">
              TJS {product.price_per_person}
            </div>
            <div className="text-gray-400 line-through text-lg mb-1">
              TJS {product.original_price}
            </div>
            <div className="text-xs text-white bg-red-500 px-2 py-1 rounded-full mb-1">
              {t('groupBuy.groupPrice')}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>
                {product.group_size}
                {t('groupBuy.peopleGroup')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>
                {product.timeout_hours}
                {t('groupBuy.hoursLimit')}
              </span>
            </div>
          </div>
        </div>

        {/* Price Comparison List */}
        <PriceComparisonList 
          comparisons={product.price_comparisons || []} 
          t={t} 
        />

        {/* Active Sessions */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3">
            {sessions.length > 0 ? t('groupBuy.joinExisting') : t('groupBuy.noActiveGroups')}
          </h2>

          {sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((session) => {
                const isParticipated = userParticipatedSessions.has(session.id);
                const isProcessing = joiningSessionId === session.id;
                
                return (
                  <div
                    key={session.id}
                    className="bg-white border-2 border-purple-200 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-purple-500" />
                        <span className="font-bold text-gray-800">
                          {session.current_participants}/{session.max_participants}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Clock className="w-4 h-4" />
                        {calculateTimeLeft(session.expires_at)}
                      </div>
                    </div>

                    {/* 显示参与用户头像和剩余位置 - 虚席以待效果 */}
                    <div className="flex justify-center gap-4 mb-3">
                      {/* 已参与的用户 */}
                      {session.orders?.map((order: any) => (
                        <div key={order.id} className="flex flex-col items-center">
                          <img
                            src={order.users?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(order.users?.first_name || 'U')}&background=random&size=48`}
                            alt={order.users?.first_name || 'User'}
                            style={{ width: '48px', height: '48px', borderRadius: '9999px', border: '2px solid #e9d5ff', objectFit: 'cover', maxWidth: 'none' }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(order.users?.first_name || 'U')}&background=random&size=48`;
                            }}
                          />
                          <span className="text-xs text-gray-600 mt-1 max-w-[60px] truncate text-center">
                            {order.users?.first_name || `User ${order.user_id?.slice(-4) || ''}`}
                          </span>
                        </div>
                      ))}
                      {/* 剩余空位 - 虚席以待 */}
                      {Array.from({ length: session.max_participants - (session.orders?.length || 0) }).map((_, index) => (
                        <div key={`empty-${index}`} className="flex flex-col items-center">
                          <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center">
                            <span className="text-gray-400 text-lg">?</span>
                          </div>
                          <span className="text-xs text-gray-400 mt-1">
                            {t('groupBuy.waitingSlot')}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      {isParticipated ? (
                        <button
                          onClick={() => handleShare(session.session_code)}
                          className="flex-1 bg-gradient-to-r from-blue-500 to-purple-500 text-white py-2 rounded-lg font-bold hover:from-blue-600 hover:to-purple-600 transition-colors flex items-center justify-center gap-2"
                        >
                          <Share2 className="w-5 h-5" />
                          {t('groupBuy.share')}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleJoinGroup(session.id)}
                            disabled={isProcessing}
                            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white py-2 rounded-lg font-bold hover:from-purple-600 hover:to-pink-600 transition-colors disabled:opacity-50"
                          >
                            {isProcessing ? t('common.processing') : t('groupBuy.joinNow')}
                          </button>
                          <button
                            onClick={() => handleShare(session.session_code)}
                            className="px-4 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            <Share2 className="w-5 h-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-xl">
              <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">{t('groupBuy.beFirst')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="bg-white border-t border-gray-200 p-6 mt-6">
        <div className="max-w-2xl mx-auto space-y-2">
          {/* Regular Join Button (Top) - 正常开团拼团按钮 */}
          <button
            onClick={() => handleJoinGroup()}
            disabled={joiningSessionId === 'new'}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-3.5 rounded-xl font-bold text-base hover:from-purple-600 hover:to-pink-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-5 h-5" />
            <span>
              {joiningSessionId === 'new' 
                ? t('common.processing') 
                : `${t('groupBuy.startNewGroup')} (TJS ${product.price_per_person})`
              }
            </span>
          </button>

          {/* Squad Buy Button (Bottom) - 一键包团按钮 */}
          <button
            onClick={handleSquadBuyClick}
            disabled={isSquadBuying || userParticipatedSessions.size > 0}
            className="relative w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white py-3.5 rounded-xl font-bold text-base hover:from-yellow-500 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
          >
            <Crown className="w-5 h-5" />
            <span>{t('groupBuy.squadBuy.title')}</span>
            {/* Limited Time Badge */}
            <span className="absolute -top-2 -right-2 px-2.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full animate-pulse shadow-md">
              {t('common.limitedTime')}
            </span>
          </button>
        </div>
      </div>

      {/* Squad Buy Confirm Modal */}
      <SquadBuyConfirmModal
        isOpen={showSquadConfirm}
        onClose={() => !isSquadBuying && setShowSquadConfirm(false)}
        onConfirm={handleConfirmSquadBuy}
        product={product}
        isProcessing={isSquadBuying}
        t={t}
      />
    </div>
  );
}
