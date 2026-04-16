import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  TruckIcon,
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';

export type LogisticsStatusType = 
  | 'PENDING_SHIPMENT'      // 待发货
  | 'IN_TRANSIT_CHINA'      // 中国段运输中
  | 'IN_TRANSIT_TAJIKISTAN' // 塔吉克斯坦段运输中
  | 'READY_FOR_PICKUP'      // 待自提
  | 'PICKED_UP';            // 已提货

interface LogisticsStatusProps {
  status: LogisticsStatusType | string | null;
  chinaTrackingNo?: string | null;
  tajikistanTrackingNo?: string | null;
  estimatedArrivalDate?: string | null;
  pickupCode?: string | null;
  className?: string;
}

interface StatusStep {
  key: LogisticsStatusType;
  label: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
}

export const LogisticsStatus: React.FC<LogisticsStatusProps> = ({
  status,
  chinaTrackingNo,
  tajikistanTrackingNo,
  estimatedArrivalDate,
  pickupCode,
  className = '',
}) => {
  const { t } = useTranslation();

  const steps: StatusStep[] = [
    {
      key: 'PENDING_SHIPMENT',
      label: t('logistics.pendingShipment'),
      icon: <ClockIcon className="w-5 h-5" />,
      activeIcon: <CheckCircleSolidIcon className="w-5 h-5" />,
    },
    {
      key: 'IN_TRANSIT_CHINA',
      label: t('logistics.inTransitChina'),
      icon: <TruckIcon className="w-5 h-5" />,
      activeIcon: <CheckCircleSolidIcon className="w-5 h-5" />,
    },
    {
      key: 'IN_TRANSIT_TAJIKISTAN',
      label: t('logistics.inTransitTajikistan'),
      icon: <GlobeAltIcon className="w-5 h-5" />,
      activeIcon: <CheckCircleSolidIcon className="w-5 h-5" />,
    },
    {
      key: 'READY_FOR_PICKUP',
      label: t('logistics.readyForPickup'),
      icon: <MapPinIcon className="w-5 h-5" />,
      activeIcon: <CheckCircleSolidIcon className="w-5 h-5" />,
    },
    {
      key: 'PICKED_UP',
      label: t('logistics.pickedUp'),
      icon: <CheckCircleIcon className="w-5 h-5" />,
      activeIcon: <CheckCircleSolidIcon className="w-5 h-5" />,
    },
  ];

  const getStatusIndex = (s: string | null): number => {
    if (!s) {return 0;}
    const index = steps.findIndex(step => step.key === s);
    return index >= 0 ? index : 0;
  };

  const currentIndex = getStatusIndex(status);

  const getStatusColor = (index: number): string => {
    if (index < currentIndex) {return 'text-green-500 bg-green-100';}
    if (index === currentIndex) {return 'text-primary bg-amber-100';}
    return 'text-gray-400 bg-gray-100';
  };

  const getLineColor = (index: number): string => {
    if (index < currentIndex) {return 'bg-green-500';}
    return 'bg-gray-200';
  };

  // 获取当前状态的描述文本
  const getStatusDescription = (): string => {
    switch (status) {
      case 'PENDING_SHIPMENT':
        return t('logistics.pendingShipmentDesc');
      case 'IN_TRANSIT_CHINA':
        return t('logistics.inTransitChinaDesc');
      case 'IN_TRANSIT_TAJIKISTAN':
        return t('logistics.inTransitTajikistanDesc');
      case 'READY_FOR_PICKUP':
        return t('logistics.readyForPickupDesc');
      case 'PICKED_UP':
        return t('logistics.pickedUpDesc');
      default:
        return t('logistics.pendingShipmentDesc');
    }
  };

  return (
    <div className={`bg-white rounded-2xl p-5 shadow-sm ${className}`}>
      <div className="flex items-center space-x-2 mb-6">
        <TruckIcon className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold text-gray-900">
          {t('logistics.title')}
        </h2>
      </div>

      {/* 物流进度条 */}
      <div className="relative">
        <div className="flex justify-between">
          {steps.map((step, index) => (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex flex-col items-center relative z-10"
              style={{ width: `${100 / steps.length}%` }}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${getStatusColor(index)}`}
              >
                {index <= currentIndex ? step.activeIcon : step.icon}
              </div>
              <span
                className={`text-xs mt-2 text-center ${
                  index <= currentIndex ? 'text-gray-900 font-medium' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </motion.div>
          ))}
        </div>

        {/* 连接线 */}
        <div className="absolute top-5 left-0 right-0 flex justify-between px-5 -z-0">
          {steps.slice(0, -1).map((_, index) => (
            <div
              key={index}
              className={`h-0.5 flex-1 mx-1 ${getLineColor(index)}`}
            />
          ))}
        </div>
      </div>

      {/* 物流详情 */}
      <div className="mt-6 space-y-3">
        {chinaTrackingNo && (
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-sm text-gray-500">
              {t('logistics.chinaTrackingNo')}
            </span>
            <span className="font-medium text-gray-900 text-sm">{chinaTrackingNo}</span>
          </div>
        )}

        {tajikistanTrackingNo && (
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-sm text-gray-500">
              {t('logistics.tajikistanTrackingNo')}
            </span>
            <span className="font-medium text-gray-900 text-sm">{tajikistanTrackingNo}</span>
          </div>
        )}

        {estimatedArrivalDate && status && ['IN_TRANSIT_CHINA', 'IN_TRANSIT_TAJIKISTAN'].includes(status) && (
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <span className="text-sm text-gray-500">
              {t('logistics.estimatedArrival')}
            </span>
            <span className="font-medium text-gray-900 text-sm">{estimatedArrivalDate}</span>
          </div>
        )}

        {pickupCode && status === 'READY_FOR_PICKUP' && (
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-500">
              {t('logistics.pickupCode')}
            </span>
            <span className="font-bold text-primary text-lg tracking-wider">{pickupCode}</span>
          </div>
        )}
      </div>

      {/* 状态说明 */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          {getStatusDescription()}
        </p>
      </div>
    </div>
  );
};

export default LogisticsStatus;
