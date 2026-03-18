import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XMarkIcon, MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import { LazyImage } from '../LazyImage'
import { Lottery } from '../../lib/supabase'
import { getLocalizedText, copyToClipboard } from '../../lib/utils'
import { useSupabase } from '../../contexts/SupabaseContext'
import { useUser } from '../../contexts/UserContext'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

interface PurchaseModalProps {
  lottery: Lottery | null
  isOpen: boolean
  onClose: () => void
  onConfirm: (lotteryId: string, quantity: number) => Promise<void>
}

export const PurchaseModal: React.FC<PurchaseModalProps> = ({
  lottery,
  isOpen,
  onClose,
  onConfirm
}) => {
  const [quantity, setQuantity] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [purchasedCodes, setPurchasedCodes] = useState<string[]>([])
  const [showSuccess, setShowSuccess] = useState(false)

  const { lotteryService } = useSupabase()
  const { refreshWallets } = useUser() // 引入 refreshWallets
  const { t } = useTranslation() // 引入 t

  if (!lottery) return null

  const maxPurchase = Math.min(lottery.total_tickets - lottery.sold_tickets, 10)
  const totalPrice = lottery.ticket_price * quantity

  const handleQuantityChange = (delta: number) => {
    const newQuantity = quantity + delta
    if (newQuantity >= 1 && newQuantity <= maxPurchase) {
      setQuantity(newQuantity)
    }
  }

  const handleConfirm = async () => {
    if (!lottery) return

    try {
      setIsLoading(true)
      // 调用抽象后的购买服务
      const order = await lotteryService.purchaseTickets(lottery.id, quantity)
      
      // 购买成功后，使用订单中的 ticket_numbers
      const codes = order.ticket_numbers.map((num: number) => `#${num.toString().padStart(5, '0')}`)
      setPurchasedCodes(codes)
      setShowSuccess(true)
      
      toast.success(t('lottery.purchaseSuccess'))
      
      // 刷新钱包余额
      await refreshWallets()

      // 触发外部刷新，例如刷新商城列表
      onConfirm(lottery.id, quantity) 
    } catch (error: any) {
      console.error('Purchase failed:', error)
      toast.error(error.message || t('lottery.purchaseFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    onClose()
    setQuantity(1)
    setPurchasedCodes([])
    setShowSuccess(false)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 z-[60]"
          />

          {/* 对话框 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            // 调整 modal 位置，使其位于底部导航栏上方
            className="fixed inset-x-4 bottom-20 top-4 bg-white rounded-2xl shadow-2xl z-50 max-w-md mx-auto max-h-[calc(100vh-10rem)] flex flex-col"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">{t('lottery.purchaseTicket')}</h3>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <XMarkIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {showSuccess && purchasedCodes.length > 0 ? (
                /* 购买成功显示 */
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900 mb-2">{t('lottery.purchaseSuccessTitle')}</h4>
                    <p className="text-sm text-gray-600">{t('lottery.winningCodeGenerated')}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 space-y-2 max-h-60 overflow-y-auto">
                    {purchasedCodes.map((code, index) => (
                      <div key={index} className="flex items-center justify-between bg-white rounded-lg p-3">
                        <span className="font-mono font-medium text-gray-900">{code}</span>
                        <button
                          onClick={async () => {
                            const success = await copyToClipboard(code);
                            if (success) {
                              toast.success(t('common.copied'));
                            } else {
                              toast.error(t('common.copyFailed'));
                            }
                          }}
                          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          {t('common.copy')}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    {t('lottery.viewAllCodesHint')}
                  </p>
                </div>
              ) : (
                <>
              {/* 商品信息 */}
              <div className="flex items-start space-x-4">
                {lottery.image_url ? (
                  <div style={{ position: 'relative', width: '80px', height: '80px', flexShrink: 0, borderRadius: '0.75rem', overflow: 'hidden' }}>
                    <LazyImage
                      src={lottery.image_url}
                      alt={getLocalizedText(lottery.name_i18n as Record<string, string> | null, t('language')) || lottery.title}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-gradient-to-r from-purple-400 to-pink-400 flex items-center justify-center">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-1">{getLocalizedText(lottery.name_i18n as Record<string, string> | null, t('language')) || lottery.title}</h4>
                  <p className="text-sm text-gray-500">{t('lottery.period')}: {lottery.id}</p>
                  <p className="text-sm text-gray-500">{t('lottery.unitPrice')}: TJS{lottery.ticket_price.toFixed(2)}</p>
                </div>
              </div>

              {/* 数量选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('lottery.purchaseQuantity')}
                </label>
                <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
                  <button
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1}
                    className="p-2 bg-white rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                  >
                    <MinusIcon className="w-5 h-5 text-gray-600" />
                  </button>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">{quantity}</div>
                    <div className="text-xs text-gray-500 mt-1">{t('lottery.max')} {maxPurchase} {t('lottery.ticketUnit')}</div>
                  </div>

                  <button
                    onClick={() => handleQuantityChange(1)}
                    disabled={quantity >= maxPurchase}
                    className="p-2 bg-white rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                  >
                    <PlusIcon className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* 总价 */}
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t('lottery.total')}</span>
                  <span className="text-2xl font-bold text-blue-600">
                    TJS{totalPrice.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* 补贴保障提示 */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs text-amber-700 text-center">
                  ✅ {t('subsidyPool.paymentSubsidy')}
                </p>
                <p className="text-xs text-amber-600 text-center mt-1 font-medium">
                  🛡️ {t('coupon.refundNotice')}
                </p>
              </div>
                </>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="p-6 pb-8 border-t border-gray-100 flex space-x-3 bg-white">
              {showSuccess ? (
                <button
                  onClick={handleClose}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                >
                  {t('common.done')}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleClose}
                    className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={isLoading}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? t('common.processing') : t('lottery.confirmPurchase')}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
