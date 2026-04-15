import React, { useState, useEffect, useCallback } from 'react';

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import {
  ArrowLeftIcon,
  PhotoIcon,
  XMarkIcon,
  TrophyIcon
} from '@heroicons/react/24/outline';
import { uploadImage } from '@/lib/uploadImage';
import { LazyImage } from '../components/LazyImage';
import toast from 'react-hot-toast';
import { showoffService, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';

interface WinningLottery {
  id: string;
  lottery_id: string | null; // 拼团时为null
  lottery_title: string; // 显示用的标题（单一语言）
  lottery_title_full?: any; // 完整的标题（可能是字符串或多语言对象）
  prize_name: string;
  prize_image: string;
  winning_number: string;
  draw_time: string;
  source_type: 'lottery' | 'group_buy'; // 来源类型：购物或团购
}

const ShowoffCreatePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useUser();
  const [winningLotteries, setWinningLotteries] = useState<WinningLottery[]>([]);
  const [selectedLottery, setSelectedLottery] = useState<string>('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingLotteries, setIsLoadingLotteries] = useState(true);

  const fetchWinningLotteries = useCallback(async () => {
    setIsLoadingLotteries(true);
    try {
      
      if (!user?.id) {
        console.error('[ShowoffCreatePage] User ID is missing');
        throw new Error('Not authenticated');
      }

      const supabaseUrl = SUPABASE_URL;
      const supabaseKey = SUPABASE_ANON_KEY;

      // 1. 直接查询 prizes 表获取用户的获奖记录（购物类型）
      const prizesResponse = await fetch(
        `${supabaseUrl}/rest/v1/prizes?user_id=eq.${user.id}&select=*&order=won_at.desc`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
        }
      );

      if (!prizesResponse.ok) {
        const errorText = await prizesResponse.text();
        console.error('[ShowoffCreatePage] Prizes fetch failed:', errorText);
        throw new Error(`Failed to fetch prizes: ${prizesResponse.status}`);
      }

      const prizes = await prizesResponse.json();

      // 2. 查询拼团获奖记录 - 用户是获奖者的记录
      const groupBuyResponse = await fetch(
        `${supabaseUrl}/rest/v1/group_buy_results?user_id=eq.${user.id}&status=eq.PENDING&select=*&order=created_at.desc`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
        }
      );

      const groupBuyResults = groupBuyResponse.ok ? await groupBuyResponse.json() : [];

      // 获取关联的彩票信息
      const lotteryIds = [...new Set(prizes.map((p: any) => p.lottery_id).filter(Boolean))];
      let lotteriesMap: Record<string, any> = {};
      
      if (lotteryIds.length > 0) {
        const lotteriesResponse = await fetch(
          `${supabaseUrl}/rest/v1/lotteries?id=in.(${lotteryIds.join(',')})&select=id,title,title_i18n,image_url`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (lotteriesResponse.ok) {
          const lotteriesData = await lotteriesResponse.json();
          lotteriesData.forEach((l: any) => {
            lotteriesMap[l.id] = l;
          });
        }
      }

      // 获取关联的拼团商品信息
      const productIds = [...new Set(groupBuyResults.map((g: any) => g.product_id).filter(Boolean))];
      let productsMap: Record<string, any> = {};
      
      if (productIds.length > 0) {
        const productsResponse = await fetch(
          `${supabaseUrl}/rest/v1/group_buy_products?id=in.(${productIds.join(',')})&select=id,title,name,image_url`,
          {
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
            },
          }
        );
        if (productsResponse.ok) {
          const productsData = await productsResponse.json();
          productsData.forEach((p: any) => {
            productsMap[p.id] = p;
          });
        }
      }

      // 合并数据
      const enrichedPrizes = prizes.map((prize: any) => ({
        ...prize,
        lottery: lotteriesMap[prize.lottery_id] || null,
        source_type: 'lottery' as const,
      }));

      const enrichedGroupBuyResults = groupBuyResults.map((result: any) => ({
        ...result,
        product: productsMap[result.product_id] || null,
        source_type: 'group_buy' as const,
      }));

      // 3. 获取已发布的晒单（通过 prize_id 关联）
      // 只排除 APPROVED 和 PENDING 状态的晒单，REJECTED 状态的可以再次发布
      const showoffsResponse = await fetch(
        `${supabaseUrl}/rest/v1/showoffs?user_id=eq.${user?.id}&status=in.(APPROVED,PENDING)&select=prize_id`,
        {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
        }
      );

      const publishedShowoffs = showoffsResponse.ok ? await showoffsResponse.json() : [];
      const publishedPrizeIds = new Set(publishedShowoffs.map((s: any) => s.prize_id).filter(Boolean));

      // 4. 过滤掉已有 APPROVED 或 PENDING 晒单的获奖记录
      const availablePrizes = enrichedPrizes
        .filter((prize: any) => !publishedPrizeIds.has(prize.id));

      const availableGroupBuyResults = enrichedGroupBuyResults
        .filter((result: any) => !publishedPrizeIds.has(result.id));

      // 5. 转换为 WinningLottery 格式
      // 购物获奖记录
      const lotteryWinnings: WinningLottery[] = availablePrizes.map((prize: any) => {
        // 获取商品名称，优先使用 title_i18n 多语言标题，其次使用 prize_name，最后使用 lottery.title
        const titleI18n = prize.lottery?.title_i18n;
        // 如果有多语言标题，优先使用当前语言
        let lotteryTitle: any;
        if (titleI18n && typeof titleI18n === 'object') {
          lotteryTitle = titleI18n;
        } else {
          lotteryTitle = prize.prize_name || prize.lottery?.title || t('showoff.unknownLottery');
        }
        // 如果 title 是字符串，直接使用；如果是对象，使用当前语言版本
        const displayTitle = typeof lotteryTitle === 'string' ? lotteryTitle : (lotteryTitle[i18n.language] || lotteryTitle.tg || lotteryTitle.ru || lotteryTitle.zh || t('showoff.unknownLottery'));
        
        return {
          id: prize.id,
          lottery_id: prize.lottery_id,
          lottery_title: displayTitle,
          lottery_title_full: lotteryTitle, // 保存完整的 title（可能是字符串或对象）
          prize_name: displayTitle,
          prize_image: prize.prize_image || prize.lottery?.image_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3C/svg%3E',
          winning_number: prize.winning_code || prize.winning_number || '',
          draw_time: prize.won_at,
          source_type: 'lottery' as const,
        };
      });

      // 拼团获奖记录
      const groupBuyWinnings: WinningLottery[] = availableGroupBuyResults.map((result: any) => {
        const product = result.product;
        // 获取商品名称，优先使用 title（多语言），其次使用 name
        const productTitle = product?.title || product?.name || t('showoff.unknownGroupBuy');
        // 如果 title 是对象，使用中文版本作为显示；如果是字符串，直接使用
        const displayTitle = typeof productTitle === 'object' ? (productTitle[i18n.language] || productTitle.tg || productTitle.ru || productTitle.zh || t('showoff.unknownGroupBuy')) : productTitle;
        
        return {
          id: result.id,
          lottery_id: null, // 拼团商品不属于lotteries表,设置为null
          lottery_title: `${t('showoff.groupBuyWin')} - ${displayTitle}`,
          lottery_title_full: productTitle, // 保存完整的 title（可能是字符串或对象）
          prize_name: displayTitle,
          prize_image: product?.image_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3C/svg%3E',
          winning_number: result.pickup_code || '',
          draw_time: result.created_at,
          source_type: 'group_buy' as const,
        };
      });

      // 6. 合并并按时间排序
      const allWinnings = [...lotteryWinnings, ...groupBuyWinnings]
        .sort((a, b) => new Date(b.draw_time).getTime() - new Date(a.draw_time).getTime());

      setWinningLotteries(allWinnings);
      
      if (allWinnings.length === 0) {
      }
    } catch (error) {
      console.error('[ShowoffCreatePage] Failed to fetch winning lotteries:', error);
      toast.error(t('error.networkError'));
    } finally {
      setIsLoadingLotteries(false);
    }
  }, [t, user]);

  useEffect(() => {
    fetchWinningLotteries();
  }, [fetchWinningLotteries]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    
    const files = e.target.files;
    if (!files || files.length === 0) {
      console.error('[ShowoffCreatePage] No files selected');
      return;
    }

    const newFiles = Array.from(files);

    if (images.length + newFiles.length > 9) {
      toast.error(t('showoff.maxImagesError'));
      return;
    }

    setIsLoading(true);
    try {
      const uploadedUrls: string[] = [];
      
      for (const file of newFiles) {
        // 1. 上传图片 (uploadImage 内部已包含压缩和 WebP 转换)
        const publicUrl = await uploadImage(file, true, 'payment-proofs', 'showoff-images');
        uploadedUrls.push(publicUrl);
      }

      setImages(prev => [...prev, ...uploadedUrls]);
      toast.success(t('showoff.imagesUploadedAndOptimized'));

    } catch (error) {
      console.error('[ShowoffCreatePage] Image compression/upload error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`${t('showoff.imageUploadFailed')}: ${errorMessage}`);
    } finally {
      setIsLoading(false);
      // 清空文件输入框，以便再次选择相同文件
      e.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    
    if (!selectedLottery) {
      console.error('[ShowoffCreatePage] No lottery selected');
      toast.error(t('showoff.selectWinningRecordError'));
      return;
    }

    if (!content.trim()) {
      console.error('[ShowoffCreatePage] Content is empty');
      toast.error(t('showoff.contentRequiredError'));
      return;
    }

    if (content.length < 10) {
      console.error('[ShowoffCreatePage] Content too short:', content.length);
      toast.error(t('showoff.minContentLengthError'));
      return;
    }

    if (images.length === 0) {
      console.error('[ShowoffCreatePage] No images uploaded');
      toast.error(t('showoff.imageRequiredError'));
      return;
    }

    setIsLoading(true);
    try {
      // 获取选中的获奖记录
      const selectedLotteryData = winningLotteries.find(l => l.id === selectedLottery);
      if (!selectedLotteryData) {
        console.error('[ShowoffCreatePage] Selected lottery not found:', selectedLottery);
        toast.error(t('showoff.prizeNotFound'));
        return;
      }
      
      // 调用晒单创建 API
      // 如果 lottery_title_full 是对象，转换为 JSON 字符串；否则直接使用
      const titleToSave = selectedLotteryData.lottery_title_full 
        ? (typeof selectedLotteryData.lottery_title_full === 'object' 
            ? JSON.stringify(selectedLotteryData.lottery_title_full) 
            : selectedLotteryData.lottery_title_full)
        : selectedLotteryData.lottery_title;
      
      await showoffService.createShowoff({
        prize_id: selectedLotteryData.id, // prize_id 是 prizes 表的 id
        lottery_id: selectedLotteryData.lottery_id || null, // 拼团时为null
        title: titleToSave, // 保存完整的商品名称（可能是 JSON 字符串或普通字符串）
        content: content.trim(),
        images: images,
        user_id: user?.id, // 传入 user_id 避免 session 问题
      });

      toast.success(t('showoff.showoffSuccessPending'));
      navigate('/showoff');
    } catch (error) {
      console.error('[ShowoffCreatePage] Failed to create showoff:', error);
      toast.error(error instanceof Error ? error.message : t('error.networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  const selectedLotteryData = winningLotteries.find(l => l.id === selectedLottery);

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center space-x-2 text-gray-700 hover:text-gray-900"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            <span>{t('common.back')}</span>
          </button>
          <h1 className="text-lg font-bold text-gray-900">{t('showoff.createShowoff')}</h1>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? `${t('showoff.publish')}...` : t('showoff.publish')}
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Select Winning Lottery */}
        <div className="bg-white rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3">{t('showoff.selectPrizeRecord')}</h3>
          {isLoadingLotteries ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : winningLotteries.length === 0 ? (
            <div className="text-center py-8">
              <TrophyIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{t('showoff.noPrizes')}</p>
              <p className="text-sm text-gray-400 mt-1">{t('showoff.noPrizesHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {winningLotteries.map((lottery) => (
                <button
                  key={lottery.id}
                  onClick={() => setSelectedLottery(lottery.id)}
                  className={`w-full flex items-center space-x-3 p-3 rounded-lg border-2 transition-all ${
                    selectedLottery === lottery.id
                      ? 'border-primary bg-amber-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0, borderRadius: '0.5rem', overflow: 'hidden' }}>
                    <LazyImage
                      src={lottery.prize_image}
                      alt={lottery.prize_name}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center space-x-2">
                      <p className="font-medium text-gray-900">{lottery.prize_name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        lottery.source_type === 'group_buy' 
                          ? 'bg-amber-100 text-primary-dark' 
                          : 'bg-amber-100 text-primary-dark'
                      }`}>
                        {lottery.source_type === 'group_buy' ? t('showoff.groupBuy') : t('showoff.lottery')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{lottery.lottery_title}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {lottery.source_type === 'group_buy' ? t('showoff.pickupCode') : t('showoff.winningNumber')}: {lottery.winning_number}
                    </p>
                  </div>
                  {selectedLottery === lottery.id && (
                    <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Input */}
        <div className="bg-white rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3">{t('showoff.content')}</h3>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('showoff.contentPlaceholderLong')}
            className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            maxLength={500}
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-sm text-gray-500">
              {content.length}/500
            </p>
            {content.length > 0 && content.length < 10 && (
              <p className="text-sm text-red-500">{t('showoff.minContentLength')}</p>
            )}
          </div>
        </div>

        {/* Image Upload */}
        <div className="bg-white rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 mb-3">{t('showoff.uploadImages')} ({t('showoff.maxImages')})</h3>
          <div className="grid grid-cols-3 gap-3">
            {images.map((image, index) => (
              <div key={index} style={{ position: 'relative', width: '100%', paddingBottom: '100%' }}>
		                <LazyImage
		                  src={image}
		                  alt={`${t('showoff.uploadImages')} ${index + 1}`}
		                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: '0.5rem' }}
		                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
            
            {images.length < 9 && (
              <label className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-amber-50 transition-all">
                <PhotoIcon className="w-8 h-8 text-gray-400" />
                <span className="text-xs text-gray-500 mt-2">{t('showoff.uploadImages')}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            * {t('showoff.imageFormatHint')}
          </p>
        </div>

        {/* Tips */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="font-medium text-primary-dark mb-2">{t('showoff.tips')}</h4>
          <ul className="space-y-1 text-sm text-primary-dark">
            <li>• {t('showoff.tip1')}</li>
            <li>• {t('showoff.tip2')}</li>
            <li>• {t('showoff.tip3')}</li>
            <li>• {t('showoff.tip4')}</li>
          </ul>
        </div>

        {/* Preview */}
        {selectedLotteryData && content && images.length > 0 && (
          <div className="bg-white rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('showoff.preview')}</h3>
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-light rounded-full flex items-center justify-center text-white font-bold">
                  {user?.first_name?.charAt(0) || 'U'}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{user?.first_name || t('common.user')}</p>
                  <p className="text-xs text-gray-500">{t('common.justNow')}</p>
                </div>
              </div>

              <div className="mb-3 p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200">
                <div className="flex items-center space-x-2">
                  <TrophyIcon className="w-5 h-5 text-orange-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {selectedLotteryData.prize_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {selectedLotteryData.lottery_title}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-gray-700 mb-3">{content}</p>

              <div className={`grid gap-2 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {images.slice(0, 4).map((image, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'relative',
                      borderRadius: '0.5rem',
                      overflow: 'hidden',
                      width: '100%',
                      paddingBottom: images.length === 1 ? '75%' : '100%',
                    }}
                  >
		                    <LazyImage src={image} alt={`${t('showoff.preview')} ${idx + 1}`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                    {idx === 3 && images.length > 4 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-xl font-bold">+{images.length - 4}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShowoffCreatePage;
