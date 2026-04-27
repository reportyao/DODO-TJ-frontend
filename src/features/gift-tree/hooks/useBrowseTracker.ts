/**
 * 希望之树 - 浏览商品任务追踪 Hook
 *
 * 追踪用户浏览商品详情页的行为。
 * 当用户浏览 >= 3 个不同商品，每个停留 >= 3 秒时，自动触发浇水。
 *
 * 使用方式：在 LotteryDetailPage 中调用 useBrowseTracker()
 *
 * 防御性设计：
 *  - submitted ref 防止单次会话内重复 mutate
 *  - 切换路由时基于上一个 productId 记录停留时间（而非新进入的）
 *  - sessionStorage 跨详情页持久化 already-submitted 标志，避免连续详情页之间重复提交
 *  - 用户无树或任务已完成则直接退出，避免空请求
 */
import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useWaterTree, useGiftTreeStatus } from './useGiftTree';

const BROWSE_DURATION_THRESHOLD_MS = 3000;
const BROWSE_REQUIRED_PRODUCTS = 3;
const SESSION_KEY_PREFIX = 'gift_tree_browse_submitted_';

function todayKey(): string {
  const now = new Date();
  return `${SESSION_KEY_PREFIX}${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function useBrowseTracker() {
  const location = useLocation();
  const { data: treeStatus } = useGiftTreeStatus();
  const waterTree = useWaterTree();

  const browsedProducts = useRef<Map<string, number>>(new Map());
  const currentProductId = useRef<string | null>(null);
  const enterTime = useRef<number>(0);
  const submitted = useRef<boolean>(false);

  // Initialize submitted from sessionStorage on mount
  useEffect(() => {
    try {
      if (sessionStorage.getItem(todayKey()) === '1') {
        submitted.current = true;
      }
    } catch {
      // ignore (private mode etc.)
    }
  }, []);

  const isTaskDoneFromServer = treeStatus?.today_logs?.some(
    (log) => log.task_code === 'BROWSE_PRODUCTS' && log.count >= 1
  );

  const checkAndSubmit = useCallback(() => {
    if (submitted.current || isTaskDoneFromServer || !treeStatus?.has_tree) return;

    const qualifiedCount = Array.from(browsedProducts.current.values()).filter(
      (duration) => duration >= BROWSE_DURATION_THRESHOLD_MS
    ).length;

    if (qualifiedCount >= BROWSE_REQUIRED_PRODUCTS) {
      submitted.current = true;
      try {
        sessionStorage.setItem(todayKey(), '1');
      } catch {
        // ignore
      }
      waterTree.mutate(
        { taskCode: 'BROWSE_PRODUCTS' },
        {
          onError: () => {
            // 失败时回退标记，下次有机会再尝试
            submitted.current = false;
            try {
              sessionStorage.removeItem(todayKey());
            } catch {
              // ignore
            }
          },
        }
      );
      browsedProducts.current.clear();
    }
  }, [isTaskDoneFromServer, treeStatus, waterTree]);

  useEffect(() => {
    const match = location.pathname.match(/\/lottery\/([^/]+)/);
    if (match) {
      const productId = match[1];
      currentProductId.current = productId;
      enterTime.current = Date.now();
    } else {
      // 离开商品详情页：先记录最后一个商品的停留再清理 currentProductId
      if (currentProductId.current && enterTime.current) {
        const duration = Date.now() - enterTime.current;
        const existing = browsedProducts.current.get(currentProductId.current) || 0;
        browsedProducts.current.set(
          currentProductId.current,
          Math.max(existing, duration)
        );
      }
      currentProductId.current = null;
      enterTime.current = 0;
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
