/**
 * 希望之树 - 浏览商品任务追踪 Hook
 *
 * 追踪用户浏览商品详情页的行为。
 * 当用户浏览 >= 3 个不同商品，每个停留 >= 3 秒时，自动触发浇水。
 *
 * 使用方式：在 LotteryDetailPage 中调用 useBrowseTracker()
 */
import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useWaterTree, useGiftTreeStatus } from './useGiftTree';

export function useBrowseTracker() {
  const location = useLocation();
  const { data: treeStatus } = useGiftTreeStatus();
  const waterTree = useWaterTree();

  const browsedProducts = useRef<Map<string, number>>(new Map());
  const currentProductId = useRef<string | null>(null);
  const enterTime = useRef<number>(0);

  const isTaskDone = treeStatus?.today_logs?.some(
    (log) => log.task_code === 'BROWSE_PRODUCTS' && log.count >= 1
  );

  const checkAndSubmit = useCallback(() => {
    if (isTaskDone || !treeStatus?.has_tree) return;

    const qualifiedCount = Array.from(browsedProducts.current.values()).filter(
      (duration) => duration >= 3000
    ).length;

    if (qualifiedCount >= 3) {
      waterTree.mutate({ taskCode: 'BROWSE_PRODUCTS' });
      browsedProducts.current.clear();
    }
  }, [isTaskDone, treeStatus, waterTree]);

  useEffect(() => {
    const match = location.pathname.match(/\/lottery\/([^/]+)/);
    if (match) {
      const productId = match[1];
      currentProductId.current = productId;
      enterTime.current = Date.now();
    }

    return () => {
      if (currentProductId.current && enterTime.current) {
        const duration = Date.now() - enterTime.current;
        const existing =
          browsedProducts.current.get(currentProductId.current) || 0;
        browsedProducts.current.set(
          currentProductId.current,
          Math.max(existing, duration)
        );
        checkAndSubmit();
      }
    };
  }, [location.pathname, checkAndSubmit]);
}
