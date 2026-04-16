import React from 'react';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

interface UsageQuotaProps {
  quota: {
    remaining: number;
    total: number;
  };
}

export function UsageQuota({ quota }: UsageQuotaProps) {
  const percentage = quota.total > 0 ? (quota.remaining / quota.total) * 100 : 0;
  
  // 根据剩余次数显示不同颜色
  const getColor = () => {
    if (percentage > 50) {return 'text-green-600';}
    if (percentage > 20) {return 'text-yellow-600';}
    return 'text-red-600';
  };

  return (
    <div className="flex items-center gap-2">
      <ChatBubbleLeftRightIcon className={`w-4 h-4 ${getColor()}`} />
      <span className={`text-sm font-medium ${getColor()}`}>
        {quota.remaining}/{quota.total}
      </span>
    </div>
  );
}
