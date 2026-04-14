import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../contexts/UserContext';
import { useInviteStats } from '../hooks/useInviteStats';
import { Lottery } from '../lib/supabase';
import { PurchaseModal } from '../components/lottery/PurchaseModal';
import { ProductList } from '../components/home/ProductList';
import BannerCarousel from '../components/BannerCarousel';
import { SubsidyPoolBanner } from '../components/home/SubsidyPoolBanner';
import { useLotteries } from '../hooks/useHomeData';


const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, isLoading: userLoading } = useUser();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stats: _inviteStats } = useInviteStats();
  
  // 使用 react-query hooks 获取数据（自动缓存、重试、后台刷新）
  const {
    data: lotteries = [],
    isLoading: isLoadingLotteries,
    refetch: refetchLotteries,
  } = useLotteries();

  const nav = useNavigate();

  // 处理 PWA 深度链接参数（仅在首次挂载时执行）
  // 支持 URL 查询参数重定向，例如: /?goto=lt_xxx 或 /?ref=INVITE_CODE
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gotoParam = urlParams.get('goto');
    const refParam = urlParams.get('ref');

    if (gotoParam) {
      // 商城详情: lt_{lotteryId}
      if (gotoParam.startsWith('lt_')) {
        const lotteryId = gotoParam.replace('lt_', '');
        nav(`/lottery/${lotteryId}`, { replace: true });
      }
      // 晒单: so_{showoffId}
      else if (gotoParam.startsWith('so_')) {
        nav(`/showoff`, { replace: true });
      }
      // 拼团路由兼容（已废弃，重定向到首页）
      else if (gotoParam.startsWith('gb_') || gotoParam.startsWith('gbs_')) {
        // 停留在首页
      }
    } else if (refParam && !user && !userLoading) {
      // 邀请码链接：未登录用户自动跳转到注册页，并携带邀请码
      nav(`/register?ref=${encodeURIComponent(refParam)}`, { replace: true });
    }
  }, [nav, user, userLoading]);

  const [selectedLottery, setSelectedLottery] = useState<Lottery | null>(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);

  const handlePurchaseConfirm = (_lotteryId: string, _quantity: number) => {
    void refetchLotteries();
  };

  // 转换商城数据格式用于列表
  const lotteryListProducts = lotteries.map(l => ({
    id: l.id,
    type: 'lottery' as const,
    image_url: l.image_url,
    price: l.original_price || l.ticket_price * l.total_tickets,
    ticket_price: l.ticket_price,
    title_i18n: l.title_i18n as Record<string, string> | null,
    name_i18n: (l as any).name_i18n as Record<string, string> | null,
    sold_tickets: l.sold_tickets,
    total_tickets: l.total_tickets,
    status: l.status,
    created_at: l.created_at,
    price_comparisons: (l.price_comparisons || null) as { price: number; platform: string }[] | null,
  }));

  // 加载中：仅在用户状态初始化期间显示（不阻塞商品列表）
  // 注意：不再因 !user 而显示登录提示页，允许未登录用户浏览首页
  return (
    <div className="pb-20 bg-gray-50">
      {/* Banner广告位 */}
      <div className="px-4 pt-4">
        <BannerCarousel />
      </div>

      {/* 补贴池横条 */}
      <SubsidyPoolBanner />

      {/* 商城商品完整列表 */}
      <ProductList
        title={t('home.lotteryProducts')}
        products={lotteryListProducts}
        isLoading={isLoadingLotteries}
        emptyText={t('home.noLotteries')}
        linkPrefix="/lottery"
        requireAuthOnClick={!user}
      />

      {/* 购买模态框（已登录用户才会触发） */}
      <PurchaseModal
        lottery={selectedLottery}
        isOpen={isPurchaseModalOpen}
        onClose={() => {
          setIsPurchaseModalOpen(false)
          setSelectedLottery(null)
        }}
        onConfirm={handlePurchaseConfirm}
      />
    </div>
  );
};

export default HomePage;
