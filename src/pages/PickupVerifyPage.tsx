/**
 * PickupVerifyPage - 前端核销员提货核销页面
 * 
 * 功能：
 *   1. 输入6位提货码查询订单详情
 *   2. 展示商品信息、用户信息、状态
 *   3. 可选拍照留证
 *   4. 确认核销（二次确认弹窗）
 *   5. 今日核销记录列表
 * 
 * 认证方式：
 *   通过 localStorage 中的 custom_session_token 验证身份
 *   （与 PromoterDepositPage 保持一致）
 * 
 * 配色规范：
 *   主色: #B8860B (暗金色) / primary
 *   辅助色: #006B6B (宝石绿) / accent
 *   成功: #2E7D32 / success
 *   错误: #C62828 / destructive
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUser } from '../contexts/UserContext'
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  XMarkIcon,
  CameraIcon,
  XCircleIcon,
  CheckBadgeIcon,
  ShoppingBagIcon,
  UserIcon,
  MapPinIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../lib/supabase'
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'
import { uploadImage } from '../lib/uploadImage'
import toast from 'react-hot-toast'
import i18nInstance from '../i18n/config'

// ============================================================
// 类型定义
// ============================================================
interface OrderData {
  id: string
  prize_name: string
  prize_image: string
  prize_value: number
  pickup_code: string
  pickup_status: string
  expires_at: string | null
  claimed_at: string | null
  source_type: 'lottery' | 'group_buy' | 'full_purchase'
  user: {
    id: string
    phone_number: string | null
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
  pickup_point: {
    id: string
    name: string
    name_i18n?: { zh?: string; ru?: string; tg?: string } | null
    address: string
    address_i18n?: { zh?: string; ru?: string; tg?: string } | null
  } | null
  target_user_id: string | null
}

interface TodayLog {
  id: string
  prize_id: string
  pickup_code: string
  operation_type: string
  order_type: string | null
  notes: string | null
  created_at: string
  prize_name: string | null
  prize_image: string | null
}

// ============================================================
// 组件
// ============================================================
const PickupVerifyPage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { user } = useUser()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  // ========== 状态 ==========
  const [pickupCode, setPickupCode] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [orderData, setOrderData] = useState<OrderData | null>(null)
  const [searchError, setSearchError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [verifySuccess, setVerifySuccess] = useState(false)
  const [todayLogs, setTodayLogs] = useState<TodayLog[]>([])
  const [todayCount, setTodayCount] = useState(0)
  const [staffPointName, setStaffPointName] = useState('')

  // 拍照相关
  const [proofImageUrl, setProofImageUrl] = useState<string | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ========== 获取 session_token ==========
  const getSessionToken = useCallback(() => {
    return localStorage.getItem('custom_session_token')
  }, [])

  // ========== 调用 Edge Function ==========
  const callVerifyPickup = useCallback(async (body: Record<string, any>) => {
    const sessionToken = getSessionToken()
    if (!sessionToken) {
      throw new Error(t('pickupVerify.notLoggedIn'))
    }

    const { data, error } = await supabase.functions.invoke('frontend-verify-pickup', {
      body: {
        ...body,
        session_token: sessionToken,
      },
    })

    if (error) {
      const errorMsg = await extractEdgeFunctionError(error)
      throw new Error(errorMsg)
    }

    return data
  }, [getSessionToken, t])

  // ========== 加载今日核销记录 ==========
  const loadTodayLogs = useCallback(async () => {
    try {
      const result = await callVerifyPickup({ action: 'get_today_logs' })
      if (result?.success && result?.data) {
        setTodayLogs(result.data.logs || [])
        setTodayCount(result.data.count || 0)
      }
    } catch (err: any) {
      console.error('[PickupVerifyPage] loadTodayLogs error:', err)
    }
  }, [callVerifyPickup])

  // ========== 初始化 ==========
  useEffect(() => {
    loadTodayLogs()
    // 自动聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [loadTodayLogs])

  // ========== 查询提货码 ==========
  const handleSearch = async () => {
    const code = pickupCode.trim()
    if (code.length !== 6) {
      toast.error(t('pickupVerify.inputPlaceholder'))
      return
    }

    setIsSearching(true)
    setSearchError('')
    setOrderData(null)
    setVerifySuccess(false)
    setProofImageUrl(null)
    setProofPreview(null)

    try {
      const result = await callVerifyPickup({
        action: 'search',
        pickup_code: code,
      })

      if (result?.success && result?.data) {
        setOrderData(result.data)
        // 提取自提点名称
        if (result.data.pickup_point) {
          const pp = result.data.pickup_point
          const localizedName = pp.name_i18n?.[i18n.language as keyof typeof pp.name_i18n] || pp.name || ''
          setStaffPointName(localizedName)
        }
      } else {
        // 优先使用 error_code 进行 i18n 翻译，避免显示后端硬编码的中文
        let errorMsg = t('pickupVerify.notFoundMsg')
        if (result?.error_code) {
          const translated = i18nInstance.t(`edgeErrors.${result.error_code}`)
          if (translated && translated !== `edgeErrors.${result.error_code}`) {
            errorMsg = translated
          }
        }
        setSearchError(errorMsg)
      }
    } catch (err: any) {
      console.error('[PickupVerifyPage] Search error:', err)
      setSearchError(err.message || t('pickupVerify.notFoundMsg'))
    } finally {
      setIsSearching(false)
    }
  }

  // ========== 拍照上传 ==========
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {return}

    // 本地预览
    const reader = new FileReader()
    reader.onloadend = () => setProofPreview(reader.result as string)
    reader.readAsDataURL(file)

    setIsUploading(true)
    try {
      const url = await uploadImage(file, true, 'payment-proofs', 'pickup-proofs')
      setProofImageUrl(url)
      toast.success(t('pickupVerify.photoUploaded'))
    } catch (err: any) {
      console.error('[PickupVerifyPage] Photo upload error:', err)
      toast.error(t('pickupVerify.photoUploadFailed'))
      // 上传失败不阻止核销
    } finally {
      setIsUploading(false)
    }
  }

  // ========== 移除照片 ==========
  const handleRemovePhoto = () => {
    setProofImageUrl(null)
    setProofPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // ========== 确认核销 ==========
  const handleVerify = async () => {
    if (!orderData) {return}

    setIsVerifying(true)
    setShowConfirmModal(false)

    try {
      const result = await callVerifyPickup({
        action: 'verify',
        pickup_code: orderData.pickup_code,
        proof_image_url: proofImageUrl || undefined,
      })

      if (result?.success) {
        setVerifySuccess(true)
        toast.success(t('pickupVerify.successMsg'))

        // 震动反馈（如果设备支持）
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100])
        }

        // 刷新今日记录
        loadTodayLogs()

        // 2秒后自动清空，准备下一次核销
        setTimeout(() => {
          setPickupCode('')
          setOrderData(null)
          setVerifySuccess(false)
          setSearchError('')
          setProofImageUrl(null)
          setProofPreview(null)
          inputRef.current?.focus()
        }, 2000)
      } else {
        // 优先使用 error_code 进行 i18n 翻译
        let errorMsg = t('pickupVerify.statusErrorMsg')
        if (result?.error_code) {
          const translated = i18nInstance.t(`edgeErrors.${result.error_code}`)
          if (translated && translated !== `edgeErrors.${result.error_code}`) {
            errorMsg = translated
          }
        }
        toast.error(errorMsg)
      }
    } catch (err: any) {
      console.error('[PickupVerifyPage] Verify error:', err)
      toast.error(err.message || t('pickupVerify.statusErrorMsg'))
    } finally {
      setIsVerifying(false)
    }
  }

  // ========== 获取来源类型文案 ==========
  const getSourceTypeText = (type: string) => {
    const map: Record<string, string> = {
      lottery: t('pickupVerify.sourceType.lottery'),
      group_buy: t('pickupVerify.sourceType.group_buy'),
      full_purchase: t('pickupVerify.sourceType.full_purchase'),
    }
    return map[type] || type
  }

  // ========== 计算剩余天数 ==========
  const getRemainingDays = (expiresAt: string | null) => {
    if (!expiresAt) {return null}
    const now = new Date()
    const expires = new Date(expiresAt)
    const diff = expires.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  // ========== 格式化时间 ==========
  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString(i18n.language === 'zh' ? 'zh-CN' : 'ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) {return '-'}
    return new Date(dateStr).toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  // ========== 获取状态样式 ==========
  const getStatusStyle = (status: string) => {
    const map: Record<string, { text: string; bg: string; textColor: string }> = {
      PENDING_CLAIM: {
        text: t('pickupVerify.status.pendingClaim'),
        bg: 'bg-yellow-50',
        textColor: 'text-yellow-700',
      },
      PENDING_PICKUP: {
        text: t('pickupVerify.status.pendingPickup'),
        bg: 'bg-blue-50',
        textColor: 'text-blue-700',
      },
      READY_FOR_PICKUP: {
        text: t('pickupVerify.status.readyForPickup'),
        bg: 'bg-green-50',
        textColor: 'text-green-700',
      },
      PICKED_UP: {
        text: t('pickupVerify.status.pickedUp'),
        bg: 'bg-gray-50',
        textColor: 'text-gray-500',
      },
      EXPIRED: {
        text: t('pickupVerify.status.expired'),
        bg: 'bg-red-50',
        textColor: 'text-red-700',
      },
    }
    return map[status] || { text: status, bg: 'bg-gray-50', textColor: 'text-gray-600' }
  }

  // ========== 输入处理 ==========
  const handleCodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6)
    setPickupCode(value)
    // 清除之前的搜索结果
    if (orderData) {
      setOrderData(null)
      setSearchError('')
      setVerifySuccess(false)
    }
  }

  // 回车自动查询
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && pickupCode.length === 6) {
      handleSearch()
    }
  }

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ========== 顶部导航栏 ========== */}
      <div className="sticky top-0 z-30 bg-gradient-to-r from-primary to-primary-dark">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-lg font-bold text-white">
            {t('pickupVerify.pageTitle') }
          </h1>
          <div className="w-10" /> {/* 占位 */}
        </div>
        {/* 自提点信息 + 今日统计 */}
        <div className="px-4 pb-3 flex items-center justify-between">
          {staffPointName ? (
            <div className="flex items-center space-x-1 text-white/80 text-xs">
              <MapPinIcon className="w-3.5 h-3.5" />
              <span>{staffPointName}</span>
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center space-x-1 bg-white/15 rounded-full px-3 py-1">
            <CheckBadgeIcon className="w-3.5 h-3.5 text-white/90" />
            <span className="text-xs text-white/90 font-medium">
              {t('pickupVerify.todayCount') }: {todayCount}
            </span>
          </div>
        </div>
      </div>

      {/* ========== 提货码输入区 ========== */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-4 mt-4"
      >
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-600 mb-3">
            {t('pickupVerify.inputLabel') }
          </label>
          
          {/* 大字号输入框 */}
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pickupCode}
              onChange={handleCodeInput}
              onKeyDown={handleKeyDown}
              placeholder={t('pickupVerify.inputPlaceholder') }
              className="w-full text-center text-3xl font-bold tracking-[0.5em] py-4 px-4 border-2 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all bg-gray-50 placeholder:text-base placeholder:tracking-normal placeholder:text-gray-400"
              autoComplete="off"
            />
            {pickupCode.length > 0 && (
              <button
                onClick={() => {
                  setPickupCode('')
                  setOrderData(null)
                  setSearchError('')
                  setVerifySuccess(false)
                  inputRef.current?.focus()
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 active:bg-gray-300"
              >
                <XMarkIcon className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>

          {/* 查询按钮 */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSearch}
            disabled={pickupCode.length !== 6 || isSearching}
            className={`w-full mt-4 py-3.5 rounded-xl font-semibold text-base flex items-center justify-center space-x-2 transition-all ${
              pickupCode.length === 6 && !isSearching
                ? 'bg-primary text-white active:bg-primary-dark shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isSearching ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{t('pickupVerify.searching') }</span>
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="w-5 h-5" />
                <span>{t('pickupVerify.searchBtn') }</span>
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* ========== 查询错误提示 ========== */}
      <AnimatePresence>
        {searchError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-4 mt-4"
          >
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 flex items-start space-x-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">{searchError}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 核销成功提示 ========== */}
      <AnimatePresence>
        {verifySuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="mx-4 mt-4"
          >
            <div className="bg-success/5 border border-success/20 rounded-xl p-6 flex flex-col items-center space-y-2">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10, stiffness: 200, delay: 0.1 }}
              >
                <CheckCircleIcon className="w-16 h-16 text-success" />
              </motion.div>
              <p className="text-lg font-bold text-success">
                {t('pickupVerify.successMsg') }
              </p>
              <p className="text-xs text-gray-500">
                {t('pickupVerify.autoResetHint') }
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 查询结果卡片 ========== */}
      <AnimatePresence>
        {orderData && !verifySuccess && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mx-4 mt-4 space-y-4"
          >
            {/* 商品信息卡片 */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* 商品图片 + 基本信息 */}
              <div className="flex p-4 space-x-4">
                {orderData.prize_image ? (
                  <img
                    src={orderData.prize_image}
                    alt={orderData.prize_name}
                    className="w-20 h-20 rounded-xl object-cover flex-shrink-0 bg-gray-100"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <ShoppingBagIcon className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900 truncate">
                    {orderData.prize_name}
                  </h3>
                  <div className="flex items-center space-x-2 mt-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusStyle(orderData.pickup_status).bg} ${getStatusStyle(orderData.pickup_status).textColor}`}>
                      {getStatusStyle(orderData.pickup_status).text}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                      {getSourceTypeText(orderData.source_type)}
                    </span>
                  </div>
                  {orderData.prize_value > 0 && (
                    <p className="text-sm text-gray-500 mt-1">
                      {orderData.prize_value} TJS
                    </p>
                  )}
                </div>
              </div>

              {/* 详细信息 */}
              <div className="border-t border-gray-100 px-4 py-3 space-y-2.5">
                {/* 用户信息 */}
                {orderData.user && (
                  <div className="flex items-center space-x-2 text-sm">
                    <UserIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500">{t('pickupVerify.userName') }:</span>
                    <span className="text-gray-900 font-medium">
                      {orderData.user.first_name || ''} {orderData.user.last_name || ''}
                      {orderData.user.phone_number && (
                        <span className="text-gray-500 ml-1">({orderData.user.phone_number})</span>
                      )}
                    </span>
                  </div>
                )}

                {/* 自提点 */}
                {orderData.pickup_point && (
                  <div className="flex items-center space-x-2 text-sm">
                    <MapPinIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500">{t('pickupVerify.pickupPoint') }:</span>
                    <span className="text-gray-900 font-medium">
                      {orderData.pickup_point.name_i18n?.[i18n.language as keyof typeof orderData.pickup_point.name_i18n] || orderData.pickup_point.name}
                    </span>
                  </div>
                )}

                {/* 有效期 */}
                {orderData.expires_at && (
                  <div className="flex items-center space-x-2 text-sm">
                    <CalendarDaysIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-500">{t('pickupVerify.expiresAt') }:</span>
                    <span className={`font-medium ${
                      getRemainingDays(orderData.expires_at) !== null && getRemainingDays(orderData.expires_at)! <= 3
                        ? 'text-destructive'
                        : 'text-gray-900'
                    }`}>
                      {formatDate(orderData.expires_at)}
                      {getRemainingDays(orderData.expires_at) !== null && (
                        <span className="ml-1 text-xs">
                          ({t('pickupVerify.remainingDays', { days: getRemainingDays(orderData.expires_at) }) || `剩余 ${getRemainingDays(orderData.expires_at)} 天`})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* 提货码 */}
                <div className="flex items-center space-x-2 text-sm">
                  <CheckBadgeIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500">{t('pickupVerify.pickupCode') }:</span>
                  <span className="text-gray-900 font-bold font-mono tracking-wider">
                    {orderData.pickup_code}
                  </span>
                </div>
              </div>
            </div>

            {/* 拍照留证 */}
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">
                  {t('pickupVerify.takePhoto') }
                </span>
                {proofPreview && (
                  <button
                    onClick={handleRemovePhoto}
                    className="text-xs text-destructive flex items-center space-x-1"
                  >
                    <XCircleIcon className="w-3.5 h-3.5" />
                    <span>{t('common.delete') }</span>
                  </button>
                )}
              </div>

              {proofPreview ? (
                <div className="relative">
                  <img
                    src={proofPreview}
                    alt="Proof"
                    className="w-full h-40 object-cover rounded-xl"
                  />
                  {isUploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center">
                      <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  {proofImageUrl && (
                    <div className="absolute top-2 right-2 bg-success rounded-full p-1">
                      <CheckCircleIcon className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-28 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center space-y-2 active:bg-gray-50 transition-colors"
                >
                  <CameraIcon className="w-8 h-8 text-gray-400" />
                  <span className="text-xs text-gray-400">
                    {t('pickupVerify.tapToPhoto') }
                  </span>
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                className="hidden"
              />
            </div>

            {/* 确认核销按钮 */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowConfirmModal(true)}
              disabled={isVerifying || isUploading}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center space-x-2 transition-all shadow-md ${
                isVerifying || isUploading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-success text-white active:bg-success/90'
              }`}
            >
              {isVerifying ? (
                <>
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t('pickupVerify.verifying') }</span>
                </>
              ) : (
                <>
                  <CheckBadgeIcon className="w-6 h-6" />
                  <span>{t('pickupVerify.verifyBtn') }</span>
                </>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== 今日核销记录 ========== */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mx-4 mt-6"
      >
        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center space-x-1.5">
          <ClockIcon className="w-4 h-4" />
          <span>{t('pickupVerify.todayRecords') }</span>
        </h3>

        {todayLogs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <CheckBadgeIcon className="w-12 h-12 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              {t('pickupVerify.noRecords') }
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-50">
            {todayLogs.map((log, index) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  {/* 商品图片 */}
                  {log.prize_image ? (
                    <img
                      src={log.prize_image}
                      alt={log.prize_name || ''}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-gray-100"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                      <CheckCircleIcon className="w-5 h-5 text-success" />
                    </div>
                  )}
                  <div className="min-w-0">
                    {/* 商品标题（多语言） */}
                    {log.prize_name && (
                      <p className="text-sm font-medium text-gray-900 truncate max-w-[160px]">
                        {log.prize_name}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 font-mono">
                      {log.pickup_code}
                    </p>
                    {log.order_type && (
                      <p className="text-xs text-gray-400">
                        {getSourceTypeText(log.order_type)}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-400">
                  {formatTime(log.created_at)}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ========== 二次确认弹窗 ========== */}
      <AnimatePresence>
        {showConfirmModal && orderData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50"
            onClick={() => setShowConfirmModal(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-t-2xl w-full max-w-lg p-6"
              style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
              
              <h3 className="text-lg font-bold text-gray-900 text-center mb-4">
                {t('pickupVerify.confirmTitle') }
              </h3>

              <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('pickupVerify.productName') }</span>
                  <span className="text-gray-900 font-medium truncate ml-4 max-w-[60%] text-right">
                    {orderData.prize_name}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{t('pickupVerify.pickupCode') }</span>
                  <span className="text-gray-900 font-bold font-mono">{orderData.pickup_code}</span>
                </div>
                {orderData.user && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">{t('pickupVerify.userName') }</span>
                    <span className="text-gray-900 font-medium">
                      {orderData.user.first_name || ''} {orderData.user.phone_number || ''}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-sm text-gray-500 text-center mb-5">
                {t('pickupVerify.confirmMsg') }
              </p>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-medium active:bg-gray-50 transition-colors"
                >
                  {t('pickupVerify.cancel') }
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleVerify}
                  className="flex-1 py-3.5 rounded-xl bg-success text-white font-bold active:bg-success/90 transition-colors shadow-sm"
                >
                  {t('pickupVerify.verifyBtn') }
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default PickupVerifyPage
