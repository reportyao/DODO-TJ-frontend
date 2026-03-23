import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { walletService } from "../lib/supabase"
import { useUser } from "../contexts/UserContext"
import { ArrowLeft, ArrowDown, CheckCircle2 } from "lucide-react"
import toast from "react-hot-toast"

export default function ExchangePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { wallets, refreshWallets } = useUser()

  const [amount, setAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // 从 UserContext 获取钱包数据
  const balanceWallet = wallets.find(w => w.type === "TJS" && w.currency === "TJS")
  const coinWallet = wallets.find(w => w.type === "LUCKY_COIN")
  
  const balance = balanceWallet?.balance || 0
  const luckyCoin = coinWallet?.balance || 0

  const handleExchange = async () => {
    const amountNum = parseFloat(amount)
    
    if (!amountNum || amountNum <= 0) {
      toast.error(t("wallet.pleaseEnterValidAmount"))
      return
    }

    if (amountNum > balance) {
      toast.error(t("wallet.insufficientBalance"))
      return
    }

    try {
      setSubmitting(true)

      // 调用 Edge Function 进行兑换（余额 → 积分）
      const result = await walletService.exchangeRealToBonus(amountNum)
      
      if (result.success) {
        // 显示成功提示
        toast.success(t("wallet.exchangeSuccessMessage"))
        
        // 刷新钱包数据
        await refreshWallets()
        
        // 短暂延迟后跳转回钱包页面
        setTimeout(() => {
          navigate("/wallet")
        }, 1500)
      }
    } catch (error: any) {
      console.error("兑换失败:", error)
      toast.error(error.message || t("wallet.exchangeFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary via-primary to-red-500 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t("wallet.exchangeSuccess")}</h2>
          <p className="text-gray-600">{t("wallet.balanceUpdated")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary via-primary to-red-500 pb-20">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md p-4 flex items-center">
        <button onClick={() => navigate(-1)} className="text-white">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white text-xl font-bold ml-4">{t("wallet.exchange")}</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* 兑换卡片 */}
        <div className="bg-white rounded-2xl p-6">
          {/* 源钱包（余额） */}
          <div className="bg-gradient-to-r from-amber-100 to-amber-100 rounded-xl p-4 mb-4">
            <div className="text-sm text-gray-600 mb-1">{t("wallet.balance")}</div>
            <div className="text-2xl font-bold text-primary">{balance.toFixed(2)} TJS</div>
          </div>

          {/* 向下箭头 */}
          <div className="flex justify-center my-4">
            <div className="bg-primary text-white p-3 rounded-full">
              <ArrowDown className="w-6 h-6" />
            </div>
          </div>

          {/* 目标钱包（积分） */}
          <div className="bg-gradient-to-r from-amber-100 to-red-100 rounded-xl p-4">
            <div className="text-sm text-gray-600 mb-1">{t("wallet.luckyCoin")}</div>
            <div className="text-2xl font-bold text-primary">{luckyCoin.toFixed(2)}</div>
          </div>
        </div>

        {/* 兑换说明 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-2">{t("wallet.exchangeRules")}</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <p>• {t("wallet.exchangeRate")}: 1:1</p>
            <p>• {t("wallet.instantExchange")}</p>
            <p>• {t("wallet.noFee")}</p>
            <p className="text-red-500">• {t("wallet.oneWayExchange")}</p>
          </div>
        </div>

        {/* 兑换金额 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t("wallet.exchangeAmount")}</h2>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("wallet.enterAmount")}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-primary"
          />
          <div className="mt-2 text-sm text-gray-500">
            {t("wallet.youWillGet")}: {amount || "0"} {t("wallet.luckyCoin")}
          </div>
        </div>

        {/* 快捷金额 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t("wallet.quickAmount")}</h2>
          <div className="grid grid-cols-4 gap-2">
            {[10, 50, 100, 500].map(val => (
              <button
                key={val}
                onClick={() => setAmount(val.toString())}
                className="py-2 border-2 border-primary text-primary rounded-lg hover:bg-amber-50 transition-colors"
              >
                {val}
              </button>
            ))}
          </div>
        </div>

        {/* 兑换按钮 */}
        <button
          onClick={handleExchange}
          disabled={submitting}
          className="w-full bg-gradient-to-r from-primary to-primary text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50"
        >
          {submitting ? t("common.exchanging") : t("wallet.confirmExchange")}
        </button>
      </div>
    </div>
  )
}
