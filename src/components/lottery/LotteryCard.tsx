import React, { useState, useEffect, CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { ClockIcon, UserGroupIcon, StarIcon } from '@heroicons/react/24/outline'
import { Lottery } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { LazyImage } from '../LazyImage'
import { useTranslation } from 'react-i18next'
import { 
  formatCurrency, 
  formatDateTime, 
  getLotteryStatusColor,
  getTimeRemaining,
  cn,
  getLocalizedText,
  getLotteryCountdownTarget,
  isLotteryPurchasable,
} from '../../lib/utils'

interface LotteryCardProps {
  lottery: Lottery
  onPurchase?: (lottery: Lottery) => void
  className?: string
}

/**
 * 所有 img 标签的内联样式，确保在各种浏览器和 PWA 中正确显示
 * 使用内联样式覆盖 Tailwind v4 preflight 的 img { height: auto; max-width: 100% }
 */
const imgCoverStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: 'center',
  display: 'block',
  maxWidth: 'none',
}

export const LotteryCard: React.FC<LotteryCardProps> = ({
  lottery,
  onPurchase,
  className
}) => {
	  const { t, i18n } = useTranslation()
  // 卖罄后显示开奖倒计时，否则仅在 end_time 存在时显示活动倒计时
  const [timeRemaining, setTimeRemaining] = useState(() => getTimeRemaining(getLotteryCountdownTarget(lottery)));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeRemaining(getTimeRemaining(getLotteryCountdownTarget(lottery)));
    }, 1000);

    return () => clearInterval(timer);
  }, [lottery.end_time, lottery.draw_time, lottery.status]);

  const progress = ((lottery.sold_tickets || 0) / (lottery.total_tickets || 1)) * 100
  const isActive = isLotteryPurchasable(lottery)
  const isSoldOut = lottery.status === 'SOLD_OUT'
  const isUpcoming = lottery.status === 'UPCOMING'

  const handlePurchase = () => {
    if (onPurchase && isActive) {
      onPurchase(lottery)
    }
  }

	  const navigate = useNavigate();
	
	  const handleCardClick = () => {
	    navigate(`/lottery/${lottery.id}`);
	  };

  /** 直接使用原始图片 URL（移除了 getOptimizedImageUrl 以修复缩略图放大问题） */
  const optimizeImg = (url: string, _isLarge: boolean = false) => url;
	
	  return (
	    <motion.div
	      initial={{ opacity: 0, y: 20 }}
	      animate={{ opacity: 1, y: 0 }}
	      whileHover={{ y: -2 }}
	      onClick={handleCardClick}
	      className={cn(
	        "bg-white rounded-2xl shadow-lg overflow-hidden cursor-pointer",
	        className
	      )}
	    >
      {/* 抽奖图片 - 智能展示图片，根据图片数量自动调整布局 */}
      <div style={{ position: 'relative', height: '144px', overflow: 'hidden', backgroundColor: '#ffffff' }}>
        {(() => {
          const allImages = lottery.image_urls && lottery.image_urls.length > 0 
            ? lottery.image_urls 
            : (lottery.image_url ? [lottery.image_url] : []);
          
          // 无图片：显示默认图标
          if (allImages.length === 0) {
            return (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="text-center text-white">
                  <StarIcon className="w-12 h-12 mx-auto mb-2" />
                  <p className="text-sm font-medium">{lottery.title}</p>
                </div>
              </div>
            );
          }
          
          // 单张图片：全宽展示
          if (allImages.length === 1) {
            return (
              <img 
                src={optimizeImg(allImages[0], true)} 
                alt={lottery.title}
                loading="lazy"
                style={imgCoverStyle}
              />
            );
          }
          
          // 2张图片：左右平分
          if (allImages.length === 2) {
            return (
              <div style={{ display: 'flex', height: '100%', gap: '2px', overflow: 'hidden' }}>
                {allImages.map((img, index) => (
                  <div key={index} style={{ width: '50%', overflow: 'hidden' }}>
                    <img
                      src={optimizeImg(img)}
                      alt={`${lottery.title} ${index + 1}`}
                      loading="lazy"
                      style={imgCoverStyle}
                    />
                  </div>
                ))}
              </div>
            );
          }
          
          // 3张图片：左边大图 + 右边两小图
          if (allImages.length === 3) {
            return (
              <div style={{ display: 'flex', height: '100%', gap: '2px', overflow: 'hidden' }}>
                <div style={{ width: '50%', overflow: 'hidden' }}>
                  <img
                    src={optimizeImg(allImages[0], true)}
                    alt={`${lottery.title} 1`}
                    loading="lazy"
                    style={imgCoverStyle}
                  />
                </div>
                <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {allImages.slice(1, 3).map((img, index) => (
                    <div key={index} style={{ height: '50%', overflow: 'hidden' }}>
                      <img
                        src={optimizeImg(img)}
                        alt={`${lottery.title} ${index + 2}`}
                        loading="lazy"
                        style={imgCoverStyle}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          
          // 4张及以上图片：左边大图 + 右边三小图
          const displayImages = allImages.slice(0, 4);
          const remainingCount = allImages.length - 4;
          
          return (
            <div style={{ display: 'flex', height: '100%', gap: '2px', overflow: 'hidden' }}>
              <div style={{ width: '50%', overflow: 'hidden' }}>
                <img
                  src={optimizeImg(displayImages[0], true)}
                  alt={`${lottery.title} 1`}
                  loading="lazy"
                  style={imgCoverStyle}
                />
              </div>
              <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {displayImages.slice(1, 4).map((img, index) => (
                  <div key={index} style={{ height: '33.333%', overflow: 'hidden', position: 'relative' }}>
                    <img
                      src={optimizeImg(img)}
                      alt={`${lottery.title} ${index + 2}`}
                      loading="lazy"
                      style={imgCoverStyle}
                    />
                    {/* 最后一张图片显示剩余数量 */}
                    {index === 2 && remainingCount > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <span className="text-white font-bold text-lg">+{remainingCount}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="p-4">
        {/* 抽奖标题 */}
	        <h3 className="text-lg font-bold text-gray-900 mb-1">
	          {(() => {
	            const localizedName = getLocalizedText(lottery.name_i18n as Record<string, string> | null, i18n.language);
	            const localizedTitle = getLocalizedText(lottery.title_i18n as Record<string, string> | null, i18n.language);
	            return localizedName || localizedTitle || lottery.title;
	          })()}
	        </h3>
        
		        {lottery.description && (
		          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
		            {getLocalizedText(lottery.description_i18n as Record<string, string> | null, i18n.language) || lottery.description}
		          </p>
		        )}

        {/* 抽奖信息 */}
        <div className="space-y-3">
          {/* 价格和参与信息 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1 truncate">{t("lottery.unitPrice")}</p>
              <p className="text-base font-bold text-green-600 truncate">
                {formatCurrency('TJS', lottery.ticket_price)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1 truncate">{t("lottery.totalQuantity")}</p>
              <p className="text-sm font-semibold text-gray-900">
                {lottery.total_tickets}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1 truncate">{t("lottery.purchaseLimit")}</p>
              <p className="text-sm font-semibold text-gray-900">
                {lottery.total_tickets}
              </p>
            </div>
          </div>

          {/* 进度条 */}
          <div>
            <div className="flex items-center justify-between mb-1">
	              <div className="flex items-center text-xs text-gray-500">
	                <UserGroupIcon className="w-3 h-3 mr-1" />
	                {t('lottery.soldTickets')} {lottery.sold_tickets}/{lottery.total_tickets}
	              </div>
              <span className="text-xs text-gray-500">
                {progress.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-primary to-primary-dark h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </div>

          {/* 售罄后显示开奖倒计时 */}
          {isSoldOut && timeRemaining.total > 0 && (
            <div className="flex items-center text-xs text-red-600 font-semibold">
              <ClockIcon className="w-3 h-3 mr-1" />
              {t('lottery.drawing_in')}: {' '}
              {timeRemaining.minutes.toString().padStart(2, '0')}:
              {timeRemaining.seconds.toString().padStart(2, '0')}
            </div>
          )}

          {isUpcoming && (
            <div className="flex items-center text-xs text-gray-500">
	              <ClockIcon className="w-3 h-3 mr-1" />
	              {t('lottery.startTime')}: {formatDateTime(lottery.start_time)}
	            </div>
          )}

	          {lottery.status === 'COMPLETED' && lottery.draw_time && (
	            <div className="flex items-center text-xs text-gray-500">
		              <ClockIcon className="w-3 h-3 mr-1" />
		              {t('lottery.drawTime')}: {formatDateTime(lottery.draw_time)}
		            </div>
	          )}

          {/* 中奖号码 */}
	          {lottery.status === 'COMPLETED' && lottery.winning_ticket_number && (
		            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
			              <p className="text-xs text-yellow-700 mb-1">{t('lottery.luckyNumber')}</p>
	              <div className="flex flex-wrap gap-2">
	                <span
	                  className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-sm font-mono font-bold"
	                >
	                  {lottery.winning_ticket_number}
	                </span>
	              </div>
	            </div>
	          )}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4">
          {isActive && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handlePurchase}
              className="w-full bg-gradient-to-r from-primary to-primary-dark text-white py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200"
            >
	              {t('lottery.participate')}
	            </motion.button>
          )}

          {isSoldOut && (
            <div className="w-full bg-gray-100 text-gray-500 py-3 rounded-xl font-semibold text-center">
	              {t('lottery.soldOut')}
	            </div>
          )}

          {isUpcoming && (
            <div className="w-full bg-amber-50 text-primary py-3 rounded-xl font-semibold text-center">
	              {t('lottery.upcoming')}
	            </div>
          )}

          {lottery.status === 'COMPLETED' && (
            <div className="w-full bg-green-50 text-green-600 py-3 rounded-xl font-semibold text-center">
	              {t('lottery.completed')}
	            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
