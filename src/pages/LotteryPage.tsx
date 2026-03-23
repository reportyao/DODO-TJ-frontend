import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Lottery } from '../lib/supabase'
import { getLocalizedText } from '../lib/utils'
import { useSupabase } from '../contexts/SupabaseContext'
import { LotteryCard } from '../components/lottery/LotteryCard'
import { PurchaseModal } from '../components/lottery/PurchaseModal'
import { AdjustmentsHorizontalIcon, ClockIcon, ClipboardDocumentListIcon, PlayIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useUser } from '../contexts/UserContext'
import { useNavigate } from 'react-router-dom'

const LotteryPage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { lotteryService } = useSupabase()
  const { refreshWallets } = useUser()

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'upcoming' | 'completed' | 'drawResult'>('active')
  const [selectedLottery, setSelectedLottery] = useState<Lottery | null>(null)
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false)
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false)

  // 使用 React Query 获取数据
  const { data: lotteries = [], isLoading, refetch } = useQuery<Lottery[]>({
    queryKey: ['lotteries', filter],
    queryFn: async () => {
      if (filter === 'all') {
        return await lotteryService.getAllLotteries()
      } else if (filter === 'drawResult') {
        return await lotteryService.getLotteriesByStatus('COMPLETED' as any)
      } else {
        return await lotteryService.getLotteriesByStatus(filter.toUpperCase() as any)
      }
    },
    staleTime: 1000 * 60 * 2, // 2分钟内数据被认为是新鲜的
  })

  const filteredLotteries = useMemo(() => {
    return lotteries.filter(lottery => {
      const titleText = getLocalizedText(lottery.name_i18n as Record<string, string> | null, i18n.language) || lottery.title;
      const matchesSearch = titleText.toLowerCase().includes(searchQuery.toLowerCase())
      
      if (filter === 'all') return matchesSearch
      if (filter === 'drawResult') return matchesSearch && lottery.status === 'COMPLETED'
      return matchesSearch && lottery.status === filter.toUpperCase()
    })
  }, [lotteries, searchQuery, filter, i18n.language])

  const handlePurchaseLottery = (lottery: Lottery) => {
    setSelectedLottery(lottery)
    setIsPurchaseModalOpen(true)
  }

  const handlePurchaseConfirm = async (lotteryId: string, quantity: number) => {
    try {
      await lotteryService.purchaseTickets(lotteryId, quantity)
      toast.success(t('lottery.purchaseSuccess'))
      refetch()
      await refreshWallets()
    } catch (error: any) {
      toast.error(error.message || t('error.networkError'))
    } finally {
      setIsPurchaseModalOpen(false)
      setSelectedLottery(null)
    }
  }

  return (
    <div className="pb-20 min-h-screen bg-gray-50">
      {/* Subsidy Banner */}
      <div className="bg-white px-4 pt-4 pb-2">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg p-3 text-center shadow-sm">
          <p className="text-white text-sm font-medium">
            {t('subsidy.banner')} | {t('subsidy.lotteryHint')}
          </p>
        </div>
      </div>

      {/* 简洁的头部 - 四个按钮 */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 sticky top-0 z-20 shadow-sm">
        <div className="flex justify-between items-center max-w-2xl mx-auto">
          {/* 规则说明按钮 - 左侧 */}
          <button
            onClick={() => setIsRulesModalOpen(true)}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-50 text-primary hover:bg-amber-100 transition-all"
          >
            <InformationCircleIcon className="w-4 h-4" />
            <span className="hidden xs:inline">{t('lottery.rulesButton')}</span>
          </button>

          {/* 右侧按钮组 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setFilter('active')}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === 'active' ? 'bg-green-600 text-white shadow-md shadow-green-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <PlayIcon className="w-4 h-4" />
              <span>{t('lottery.ongoing')}</span>
            </button>

            <button
              onClick={() => setFilter('completed')}
              className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === 'completed' ? 'bg-gray-900 text-white shadow-md shadow-gray-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <ClockIcon className="w-4 h-4" />
              <span>{t('lottery.ended')}</span>
            </button>

            <button
              onClick={() => navigate('/orders')}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all"
            >
              <ClipboardDocumentListIcon className="w-4 h-4" />
              <span className="hidden xs:inline">{t('lottery.orderManagement')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 彩票列表 */}
      <div className="px-4 py-4 max-w-2xl mx-auto">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse shadow-sm">
                <div className="h-40 bg-gray-100 rounded-xl mb-4"></div>
                <div className="h-5 bg-gray-100 rounded w-3/4 mb-3"></div>
                <div className="h-4 bg-gray-100 rounded w-1/2 mb-4"></div>
                <div className="h-10 bg-gray-100 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLotteries.map((lottery) => (
                <motion.div
                  key={lottery.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <LotteryCard
                    lottery={lottery}
                    onPurchase={handlePurchaseLottery}
                  />
                </motion.div>
              ))}

            {filteredLotteries.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-3xl p-12 text-center shadow-sm"
              >
                <AdjustmentsHorizontalIcon className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                <p className="text-gray-500 font-medium">{t('home.noLotteries')}</p>
                <p className="text-sm text-gray-400 mt-1">{t('home.stayTuned')}</p>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* 购买对话框 */}
      <PurchaseModal
        lottery={selectedLottery}
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        onConfirm={handlePurchaseConfirm}
      />

      {/* 规则说明弹窗 */}
      <AnimatePresence>
        {isRulesModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md max-h-[85vh] overflow-hidden shadow-2xl"
            >
              {/* 弹窗头部 */}
              <div className="sticky top-0 bg-gradient-to-r from-primary to-primary-dark text-white px-6 py-5 flex items-center justify-between">
                <h3 className="text-xl font-black flex items-center gap-2">
                  <InformationCircleIcon className="w-7 h-7" />
                  {t('lottery.rulesTitle')}
                </h3>
                <button
                  onClick={() => setIsRulesModalOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              {/* 弹窗内容 */}
              <div className="p-6 overflow-y-auto max-h-[calc(85vh-88px)]">
                <div className="space-y-8">
                  {/* 参与方式 */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                      <h4 className="text-gray-900 font-black text-lg">
                        {t('lottery.rulesParticipation')}
                      </h4>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed pl-3.5">
                      {t('lottery.rulesParticipationDesc')}
                    </p>
                  </section>

                  {/* 开奖机制 */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-6 bg-primary rounded-full"></div>
                      <h4 className="text-gray-900 font-black text-lg">
                        {t('lottery.rulesDraw')}
                      </h4>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed pl-3.5">
                      {t('lottery.rulesDrawDesc')}
                    </p>
                  </section>

                  {/* 领奖与核销 */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-6 bg-orange-500 rounded-full"></div>
                      <h4 className="text-gray-900 font-black text-lg">
                        {t('lottery.rulesClaim')}
                      </h4>
                    </div>
                    <div className="space-y-3 pl-3.5">
                      <div className="flex gap-3">
                        <div className="mt-1.5 w-1.5 h-1.5 bg-orange-400 rounded-full flex-shrink-0"></div>
                        <p className="text-gray-600 text-sm leading-relaxed">{t('lottery.rulesClaimPrize')}</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="mt-1.5 w-1.5 h-1.5 bg-orange-400 rounded-full flex-shrink-0"></div>
                        <p className="text-gray-600 text-sm leading-relaxed">{t('lottery.rulesPickup')}</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="mt-1.5 w-1.5 h-1.5 bg-orange-400 rounded-full flex-shrink-0"></div>
                        <p className="text-gray-600 text-sm leading-relaxed">{t('lottery.rulesExpiry')}</p>
                      </div>
                    </div>
                  </section>
                </div>

                {/* 关闭按钮 */}
                <button
                  onClick={() => setIsRulesModalOpen(false)}
                  className="w-full mt-10 py-4 bg-gradient-to-r from-primary to-primary-dark text-white rounded-2xl font-bold shadow-lg shadow-amber-100 active:scale-[0.98] transition-all"
                >
                  {t('common.confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default LotteryPage
