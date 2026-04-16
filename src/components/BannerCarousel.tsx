import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { trackEvent } from '../hooks/useTrackEvent';
import type { HomeFeedBanner } from '../types/homepage';

/**
 * Banner 数据类型（兼容旧格式和新 HomeFeedBanner 格式）
 */
interface Banner {
  id: string;
  title: string;
  image_url: string;
  image_url_zh: string | null;
  image_url_ru: string | null;
  image_url_tg: string | null;
  link_url: string | null;
  link_type: string;
}

interface BannerCarouselProps {
  /**
   * [v2 性能优化] 外部传入 banner 数据，消除组件内部独立请求
   * 由 SceneHomePage 从 get-home-feed 统一获取后传入
   */
  banners?: HomeFeedBanner[];
}

/**
 * 首页轮播图组件
 *
 * [v2 性能优化]
 * - 移除组件内部的独立 react-query 请求（原先直接查询 banners 表）
 * - 改为接收外部传入的 banners 数据（来自 get-home-feed 统一接口）
 * - 首页首屏请求数从 3 个减少到 2 个（get-home-feed + get-subsidy-pool）
 * - 保留图片预加载、语言切换、自动轮播等所有功能
 *
 * [埋点]
 * - banner_click 事件上报（文档 10.1 事件清单要求）
 */
const BannerCarousel: React.FC<BannerCarouselProps> = ({ banners: externalBanners }) => {
  const { i18n } = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const preloadedRef = useRef<Set<number>>(new Set());

  // 使用外部传入的数据
  const banners: Banner[] = useMemo(() => externalBanners || [], [externalBanners]);
  const isLoading = !externalBanners;

  // 根据当前语言获取对应的图片URL
  const getLocalizedImageUrl = useCallback(
    (banner: Banner): string => {
      const lang = i18n.language;

      if (lang === 'zh' && banner.image_url_zh) {
        return banner.image_url_zh;
      }
      if (lang === 'ru' && banner.image_url_ru) {
        return banner.image_url_ru;
      }
      if (lang === 'tg' && banner.image_url_tg) {
        return banner.image_url_tg;
      }

      // 回退优先级：中文 > 俄语 > 塔吉克语 > 默认
      if (banner.image_url_zh) {
        return banner.image_url_zh;
      }
      if (banner.image_url_ru) {
        return banner.image_url_ru;
      }
      if (banner.image_url_tg) {
        return banner.image_url_tg;
      }

      return banner.image_url;
    },
    [i18n.language]
  );

  // 只预加载当前和下一张图片
  const preloadAdjacentImages = useCallback(
    (index: number) => {
      if (banners.length === 0) {
        return;
      }

      const indicesToPreload = [index, (index + 1) % banners.length];

      indicesToPreload.forEach((i) => {
        if (preloadedRef.current.has(i)) {
          return;
        }
        preloadedRef.current.add(i);

        const img = new Image();
        const banner = banners[i];
        if (banner) {
          img.src = getLocalizedImageUrl(banner);
        }
      });
    },
    [banners, getLocalizedImageUrl]
  );

  // 首次加载时预加载前两张图片
  useEffect(() => {
    if (banners.length > 0) {
      preloadAdjacentImages(0);
      // 首张图片加载完成或超时后显示
      const img = new Image();
      img.onload = () => setImagesLoaded(true);
      img.onerror = () => setImagesLoaded(true);
      img.src = getLocalizedImageUrl(banners[0]);

      // 2秒超时强制显示
      const timeout = setTimeout(() => setImagesLoaded(true), 2000);
      return () => clearTimeout(timeout);
    }
  }, [banners, getLocalizedImageUrl, preloadAdjacentImages]);

  // 语言变化时重置预加载状态
  useEffect(() => {
    preloadedRef.current = new Set();
    setImagesLoaded(false);
    if (banners.length > 0) {
      preloadAdjacentImages(currentIndex);
    }
  }, [i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  // 轮播切换时预加载下一张
  useEffect(() => {
    preloadAdjacentImages(currentIndex);
  }, [currentIndex, preloadAdjacentImages]);

  // 自动轮播
  useEffect(() => {
    if (banners.length <= 1 || !imagesLoaded) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [banners.length, imagesLoaded]);

  // Banner 点击埋点
  const handleBannerClick = useCallback((banner: Banner, position: number) => {
    trackEvent({
      event_name: 'banner_click',
      page_name: 'home',
      entity_type: 'banner',
      entity_id: banner.id,
      position: String(position),
      metadata: {
        banner_title: banner.title,
        link_url: banner.link_url || '',
        link_type: banner.link_type,
      },
    });
  }, []);

  const activeBannerIndices = useMemo(() => {
    if (banners.length === 0) {
      return [] as number[];
    }

    const indices = new Set<number>([
      currentIndex,
      (currentIndex + 1) % banners.length,
      (currentIndex - 1 + banners.length) % banners.length,
    ]);

    return Array.from(indices);
  }, [banners.length, currentIndex]);

  if (isLoading && banners.length === 0) {
    return <div className="relative h-40 bg-gray-200 rounded-2xl animate-pulse"></div>;
  }

  if (banners.length === 0) {
    return null;
  }

  const currentBanner = banners[currentIndex];

  const BannerContent = () => (
    <div className="relative h-40 overflow-hidden rounded-2xl bg-gray-100">
      {activeBannerIndices.map((index) => {
        const banner = banners[index];
        const isActive = index === currentIndex;
        const imageUrl = getLocalizedImageUrl(banner);

        return (
          <div
            key={`${banner.id}-${i18n.language}`}
            className="absolute inset-0 w-full h-full"
            style={{
              opacity: isActive ? 1 : 0,
              transform: isActive ? 'scale(1)' : 'scale(1.02)',
              transition: 'opacity 700ms ease-in-out, transform 700ms ease-in-out',
              zIndex: isActive ? 1 : 0,
              pointerEvents: isActive ? 'auto' : 'none',
            }}
          >
            <img
              src={imageUrl}
              alt={banner.title}
              loading={index === 0 ? 'eager' : 'lazy'}
              fetchPriority={index === 0 ? 'high' : 'auto'}
              decoding={index === currentIndex ? 'sync' : 'async'}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                maxWidth: 'none',
                opacity: imagesLoaded ? 1 : 0,
                transition: 'opacity 300ms ease-in-out',
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="320"%3E%3Crect fill="%23f0f0f0" width="800" height="320"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="24"%3EBanner%3C/text%3E%3C/svg%3E';
              }}
            />
          </div>
        );
      })}

      {/* 指示器 */}
      {banners.length > 1 && (
        <div className="absolute bottom-2 right-4 flex space-x-1.5 z-10">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCurrentIndex(index);
              }}
              className="w-2 h-2 rounded-full transition-all duration-300"
              style={{
                backgroundColor: index === currentIndex ? 'white' : 'rgba(255,255,255,0.5)',
                transform: index === currentIndex ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );

  // 根据链接类型决定如何渲染
  if (currentBanner.link_url) {
    if (currentBanner.link_type === 'internal') {
      return (
        <Link
          to={currentBanner.link_url}
          className="block"
          onClick={() => handleBannerClick(currentBanner, currentIndex)}
        >
          <BannerContent />
        </Link>
      );
    } else {
      return (
        <a
          href={currentBanner.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
          onClick={() => handleBannerClick(currentBanner, currentIndex)}
        >
          <BannerContent />
        </a>
      );
    }
  }

  return <BannerContent />;
};

export default BannerCarousel;
