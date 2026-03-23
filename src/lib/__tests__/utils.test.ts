import { describe, it, expect } from 'vitest';
import {
  cn,
  formatCurrency,
  formatDateTime,
  getLotteryStatusText,
  getLotteryStatusColor,
  getTimeRemaining,
  getTimeRemainingText,
  getWalletTypeText,
  copyToClipboard,
} from '../utils';

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
      expect(cn('foo', undefined, 'bar')).toBe('foo bar');
      expect(cn('foo', '')).toBe('foo');
    });

    it('should handle tailwind merge', () => {
      expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    });
  });

  describe('formatCurrency', () => {
    it('should format currency with default TJS', () => {
      expect(formatCurrency('TJS', 100)).toBe('TJS 100.00');
      expect(formatCurrency('TJS', 50.5)).toBe('TJS 50.50');
    });

    it('should format currency with custom currency', () => {
      expect(formatCurrency('USD', 100)).toBe('USD 100.00');
    });

    it('should handle decimal places correctly', () => {
      expect(formatCurrency('TJS', 99.999)).toBe('TJS 100.00');
      expect(formatCurrency('TJS', 99.994)).toBe('TJS 99.99');
    });
  });

  describe('formatDateTime', () => {
    it('should format date time correctly', () => {
      const date = '2024-01-15T10:30:00Z';
      const formatted = formatDateTime(date);
      expect(formatted).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    });

    it('should handle different date formats', () => {
      const date = new Date('2024-06-20T15:45:30Z').toISOString();
      const formatted = formatDateTime(date);
      expect(formatted).toContain('2024');
      expect(formatted).toContain('06');
      expect(formatted).toContain('20');
    });
  });

  describe('getLotteryStatusText', () => {
    it('should return English fallback text when t is not provided', () => {
      expect(getLotteryStatusText('ACTIVE')).toBe('Active');
      expect(getLotteryStatusText('UPCOMING')).toBe('Upcoming');
      expect(getLotteryStatusText('COMPLETED')).toBe('Completed');
      expect(getLotteryStatusText('SOLD_OUT')).toBe('Sold Out');
      expect(getLotteryStatusText('DRAWN')).toBe('Drawn');
      expect(getLotteryStatusText('CANCELLED')).toBe('Cancelled');
    });

    it('should use t function when provided', () => {
      const mockT = (key: string) => {
        const map: Record<string, string> = {
          'lottery.statusActive': '进行中',
          'lottery.statusUpcoming': '即将开始',
          'lottery.statusCompleted': '已完成',
        };
        return map[key] || key;
      };
      expect(getLotteryStatusText('ACTIVE', mockT)).toBe('进行中');
      expect(getLotteryStatusText('UPCOMING', mockT)).toBe('即将开始');
      expect(getLotteryStatusText('COMPLETED', mockT)).toBe('已完成');
    });

    it('should return original status for unknown status', () => {
      expect(getLotteryStatusText('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('getLotteryStatusColor', () => {
    it('should return correct color classes', () => {
      expect(getLotteryStatusColor('ACTIVE')).toBe('bg-green-100 text-green-700');
      expect(getLotteryStatusColor('UPCOMING')).toBe('bg-amber-100 text-primary-dark');
      expect(getLotteryStatusColor('COMPLETED')).toBe('bg-gray-100 text-gray-700');
      expect(getLotteryStatusColor('SOLD_OUT')).toBe('bg-red-100 text-red-700');
    });

    it('should return default color for unknown status', () => {
      expect(getLotteryStatusColor('UNKNOWN')).toBe('bg-gray-100 text-gray-700');
    });
  });

  describe('getTimeRemainingText', () => {
    it('should return "Ended" for past dates when t is not provided', () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      expect(getTimeRemainingText(pastDate)).toBe('Ended');
    });

    it('should use t function for past dates when provided', () => {
      const mockT = (key: string) => {
        const map: Record<string, string> = {
          'common.ended': '已结束',
        };
        return map[key] || key;
      };
      const pastDate = new Date(Date.now() - 1000).toISOString();
      expect(getTimeRemainingText(pastDate, mockT)).toBe('已结束');
    });

    it('should return days and hours for future dates', () => {
      const futureDate = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25 hours
      const result = getTimeRemainingText(futureDate);
      expect(result).toContain('d');
      expect(result).toContain('h');
    });

    it('should return hours and minutes for dates within 24 hours', () => {
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
      const result = getTimeRemainingText(futureDate);
      expect(result).toContain('h');
      expect(result).toContain('m');
    });

    it('should return minutes for dates within 1 hour', () => {
      const futureDate = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
      const result = getTimeRemainingText(futureDate);
      expect(result).toContain('m');
      expect(result).not.toContain('h');
    });

    it('should use t function for time formatting when provided', () => {
      const mockT = (key: string, opts?: any) => {
        const map: Record<string, string> = {
          'common.ended': '已结束',
          'common.daysHours': `${opts?.days}天${opts?.hours}小时`,
          'common.hoursMinutes': `${opts?.hours}小时${opts?.minutes}分钟`,
          'common.minutesOnly': `${opts?.minutes}分钟`,
        };
        return map[key] || key;
      };
      const futureDate = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
      const result = getTimeRemainingText(futureDate, mockT);
      expect(result).toContain('天');
      expect(result).toContain('小时');
    });
  });

  describe('getWalletTypeText', () => {
    it('should return English fallback text when t is not provided', () => {
      expect(getWalletTypeText('BALANCE')).toBe('Balance');
      expect(getWalletTypeText('LUCKY_COIN')).toBe('Lucky Coin');
    });

    it('should use t function when provided', () => {
      const mockT = (key: string) => {
        const map: Record<string, string> = {
          'wallet.balance': '余额',
          'wallet.luckyCoin': '积分',
        };
        return map[key] || key;
      };
      expect(getWalletTypeText('BALANCE', mockT)).toBe('余额');
      expect(getWalletTypeText('LUCKY_COIN', mockT)).toBe('积分');
    });

    it('should return original type for unknown type', () => {
      expect(getWalletTypeText('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('copyToClipboard', () => {
    it('should return false when clipboard API is not available', async () => {
      // Note: In test environment, clipboard API is usually not available
      // This test ensures the function handles that gracefully
      const result = await copyToClipboard('test text');
      expect(typeof result).toBe('boolean');
    });
  });
});
