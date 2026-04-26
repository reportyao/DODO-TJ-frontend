/**
 * 希望之树 - React Query Hooks
 *
 * 封装所有数据获取和变更操作，与 React Query 缓存体系集成。
 * 每次浇水或完成任务后自动刷新树状态。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '../../../contexts/UserContext';
import { giftTreeService } from '../services/giftTreeService';
import type { WaterResult } from '../types';

export const giftTreeKeys = {
  status: (userId: string) => ['giftTree', 'status', userId] as const,
  giftItems: ['giftTree', 'items'] as const,
};

/** 获取树状态（包含任务列表和今日日志） */
export function useGiftTreeStatus() {
  const { user } = useUser();
  return useQuery({
    queryKey: giftTreeKeys.status(user?.id || ''),
    queryFn: () => giftTreeService.getStatus(),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
  });
}

/** 获取可选礼物列表 */
export function useGiftItems() {
  return useQuery({
    queryKey: giftTreeKeys.giftItems,
    queryFn: () => giftTreeService.getGiftItems(),
    staleTime: 1000 * 60 * 10,
  });
}

/** 浇水 mutation */
export function useWaterTree() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      taskCode: string;
      deviceId?: string;
      referenceId?: string;
    }) =>
      giftTreeService.waterTree(
        params.taskCode,
        params.deviceId,
        params.referenceId
      ),
    onSuccess: (data: WaterResult) => {
      queryClient.invalidateQueries({
        queryKey: giftTreeKeys.status(user?.id || ''),
      });
      if (data.milestone_rewards && data.milestone_rewards.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['user', 'wallets'] });
      }
    },
  });
}

/** 开始种树 mutation */
export function useStartTree() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (giftItemId: string) =>
      giftTreeService.startTree(giftItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: giftTreeKeys.status(user?.id || ''),
      });
      queryClient.invalidateQueries({
        queryKey: giftTreeKeys.giftItems,
      });
    },
  });
}

/** 好友助力 mutation */
export function useHelpFriend() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { treeOwnerId: string; deviceId?: string }) =>
      giftTreeService.helpFriend(params.treeOwnerId, params.deviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: giftTreeKeys.status(user?.id || ''),
      });
    },
  });
}
