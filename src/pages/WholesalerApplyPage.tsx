/**
 * 批发商申请页面
 *
 * 功能：
 * - 申请成为批发商（填写姓名、电话、地址、邀请码（选填））
 * - 申请后写入 wholesaler_profiles 表（status='pending'）
 * - 管理后台可审核通过
 * - 已是批发商时显示门店信息编辑
 * - 支持 zh / ru / tg 三语言
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { useUser } from '../contexts/UserContext';
import { useSupabase } from '../contexts/SupabaseContext';
import { useWholesalerProfile, b2bQueryKeys } from '../hooks/useB2B';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

const WholesalerApplyPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useUser();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const queryClient = useQueryClient();
  const { data: wholesalerProfile, isLoading: profileLoading, refetch } = useWholesalerProfile();

  // 表单字段
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 初始化表单：如果已有资料则填入
  useEffect(() => {
    if (wholesalerProfile) {
      setName((wholesalerProfile.company_name as string | null) || (user?.first_name as string | null) || '');
      setPhone(wholesalerProfile.contact_phone || user?.phone_number || '');
      setAddress(wholesalerProfile.business_address || '');
    } else if (user) {
      setName((user.first_name as string | null) || '');
      setPhone(user.phone_number || '');
    }
  }, [wholesalerProfile, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      toast.error(t('b2b.loginRequired'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('wholesaler.nameRequired'));
      return;
    }
    if (!phone.trim()) {
      toast.error(t('wholesaler.phoneRequired'));
      return;
    }
    if (!address.trim()) {
      toast.error(t('wholesaler.addressRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      if (wholesalerProfile?.id) {
        // 已有资料 → 更新
        const { error } = await (supabase as any)
          .from('wholesaler_profiles')
          .update({
            company_name: name.trim(),
            contact_phone: phone.trim(),
            business_address: address.trim(),
            delivery_address: address.trim(),
            notes: inviteCode.trim() ? `邀请码: ${inviteCode.trim()}` : wholesalerProfile.notes,
            updated_at: now,
          })
          .eq('id', wholesalerProfile.id);

        if (error) throw new Error(error.message);
        toast.success(t('wholesaler.updateSuccess'));
      } else {
        // 新申请 → 插入（status=pending）
        const { error } = await (supabase as any)
          .from('wholesaler_profiles')
          .insert({
            user_id: user.id,
            company_name: name.trim(),
            contact_phone: phone.trim(),
            business_address: address.trim(),
            delivery_address: address.trim(),
            notes: inviteCode.trim() ? `邀请码: ${inviteCode.trim()}` : null,
            status: 'pending',
            created_at: now,
            updated_at: now,
          });

        if (error) throw new Error(error.message);
        toast.success(t('wholesaler.applySuccess'));
      }

      // 刷新缓存
      await queryClient.invalidateQueries({ queryKey: b2bQueryKeys.wholesalerProfile(user.id) });
      await refetch();
      navigate(-1);
    } catch (err: any) {
      toast.error(err.message || t('error.unknownError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const status = wholesalerProfile?.status;
  const isApproved = status === 'approved';
  const isPending = status === 'pending';
  const isRejected = status === 'rejected';

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary-dark text-white px-4 pt-12 pb-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center space-x-1 text-white/80 hover:text-white mb-4 transition-colors"
        >
          <ArrowLeftIcon className="w-5 h-5" />
          <span className="text-sm">{t('common.back')}</span>
        </button>
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <BuildingStorefrontIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">
              {isApproved ? t('wholesaler.myStore') : t('wholesaler.applyTitle')}
            </h1>
            <p className="text-white/80 text-sm mt-0.5">
              {isApproved ? t('wholesaler.editStoreInfo') : t('wholesaler.applySubtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* 状态提示 */}
      {isPending && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start space-x-3"
        >
          <ClockIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">{t('wholesaler.pendingTitle')}</p>
            <p className="text-sm text-yellow-700 mt-0.5">{t('wholesaler.pendingDesc')}</p>
          </div>
        </motion.div>
      )}

      {isApproved && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-4 p-4 bg-green-50 border border-green-200 rounded-xl flex items-start space-x-3"
        >
          <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-green-800">{t('wholesaler.approvedTitle')}</p>
            <p className="text-sm text-green-700 mt-0.5">{t('wholesaler.approvedDesc')}</p>
          </div>
        </motion.div>
      )}

      {isRejected && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3"
        >
          <XCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">{t('wholesaler.rejectedTitle')}</p>
            {wholesalerProfile?.reject_reason && (
              <p className="text-sm text-red-700 mt-0.5">{wholesalerProfile.reject_reason}</p>
            )}
            <p className="text-sm text-red-600 mt-1">{t('wholesaler.rejectedReapply')}</p>
          </div>
        </motion.div>
      )}

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="mx-4 mt-4">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* 姓名 */}
          <div className="p-4 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('wholesaler.name')}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('wholesaler.namePlaceholder')}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              required
            />
          </div>

          {/* 电话 */}
          <div className="p-4 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('wholesaler.phone')}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('wholesaler.phonePlaceholder')}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              required
            />
          </div>

          {/* 地址 */}
          <div className="p-4 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('wholesaler.address')}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('wholesaler.addressPlaceholder')}
              rows={3}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-none"
              required
            />
          </div>

          {/* 邀请码（选填） */}
          {!wholesalerProfile && (
            <div className="p-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('wholesaler.inviteCode')}
                <span className="text-gray-400 ml-1 text-xs">({t('common.optional')})</span>
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={t('wholesaler.inviteCodePlaceholder')}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>
          )}
        </div>

        {/* 提交按钮 */}
        <motion.button
          type="submit"
          disabled={submitting}
          whileTap={{ scale: 0.98 }}
          className="w-full mt-6 bg-primary text-white py-4 rounded-2xl font-semibold text-base shadow-lg shadow-primary/30 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          {submitting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>{t('common.submitting')}</span>
            </>
          ) : (
            <span>
              {isApproved || isPending || isRejected
                ? t('wholesaler.updateInfo')
                : t('wholesaler.submitApply')}
            </span>
          )}
        </motion.button>

        {/* 说明文字 */}
        {!isApproved && (
          <p className="text-center text-xs text-gray-400 mt-3">
            {t('wholesaler.reviewNote')}
          </p>
        )}
      </form>
    </div>
  );
};

export default WholesalerApplyPage;
