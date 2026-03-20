import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useUser } from '../contexts/UserContext'
// Note: This page uses Edge Functions directly, which is acceptable for this level of abstraction.
// In a larger application, these could also be moved to the service layer.
import { uploadImages } from '../lib/uploadImage'
import { ArrowLeft, Upload, CheckCircle2, Loader2, X, Image as ImageIcon } from 'lucide-react'
import { formatCurrency } from '../lib/utils'
import { extractEdgeFunctionError } from '../utils/edgeFunctionHelper'

interface PaymentConfig {
  id: string
  config_key: string
  require_payer_name?: boolean
  require_payer_account?: boolean
  require_payer_phone?: boolean
  config_data: {
    method: string
    enabled: boolean
    account_number?: string
    account_name?: string
    bank_name?: string
    phone_number?: string
    instructions: {
      zh: string
      ru: string
      tg: string
    }
    min_amount: number
    max_amount: number
    processing_time: string
  }
}

export default function DepositPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user, sessionToken } = useUser()
  const [loading, setLoading] = useState(false)
  const [configs, setConfigs] = useState<PaymentConfig[]>([])
  const [selectedMethod, setSelectedMethod] = useState<PaymentConfig | null>(null)
  const [amount, setAmount] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerAccount, setPayerAccount] = useState('')
  const [payerPhone, setPayerPhone] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'compressing' | 'uploading' | 'success' | 'error'>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchPaymentConfigs()
  }, [])

  const fetchPaymentConfigs = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase.functions.invoke('get-payment-config', {
        body: { type: 'DEPOSIT' }
      })

      if (error) throw new Error(await extractEdgeFunctionError(error))
      
      if (data?.success && data?.data) {
        setConfigs(data.data)
        if (data.data.length > 0) {
          setSelectedMethod(data.data[0])
        }
      }
    } catch (error) {
      console.error(t('deposit.failedToLoadConfig') + ':', error)
    } finally {
      setLoading(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[DepositPage] handleImageUpload triggered')
    
    const files = e.target.files
    
    if (!files || files.length === 0) {
      console.error('[DepositPage] No files selected')
      return
    }

    const fileArray = Array.from(files)
    console.log('[DepositPage] Files to upload:', fileArray.map(f => ({ name: f.name, size: f.size, type: f.type })))
    
    // 放宽文件类型检查，支持移动端
    const invalidFiles = fileArray.filter(f => {
      // 如果有type且不是image，则无效
      if (f.type && !f.type.startsWith('image/')) {
        return true
      }
      // 如果没有type，检查文件扩展名
      if (!f.type) {
        const ext = f.name.split('.').pop()?.toLowerCase()
        return !['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext || '')
      }
      return false
    })
    
    if (invalidFiles.length > 0) {
      console.error('[DepositPage] Invalid file types detected:', invalidFiles)
      alert(t('deposit.invalidFileType'))
      e.target.value = ''
      return
    }

    try {
      setUploading(true)
      setUploadStatus('compressing')
      setUploadProgress(10)
      
      console.log('[DepositPage] Starting upload process...')
      
      // 模拟压缩进度
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev < 30) return prev + 5
          return prev
        })
      }, 200)
      
      // 开始上传
      setTimeout(() => {
        setUploadStatus('uploading')
        setUploadProgress(40)
      }, 500)
      
      const urls = await uploadImages(fileArray, true, 'payment-proofs', 'deposits')
      
      clearInterval(progressInterval)
      
      console.log('[DepositPage] Upload successful, URLs:', urls)
      
      if (!urls || urls.length === 0) {
        throw new Error('Upload returned empty URLs')
      }
      
      setUploadProgress(100)
      setUploadStatus('success')
      
      setUploadedImages(prev => {
        const newImages = [...prev, ...urls]
        console.log('[DepositPage] Updated images state:', newImages)
        return newImages
      })
      
      // 延迟重置状态
      setTimeout(() => {
        setUploadStatus('idle')
        setUploadProgress(0)
      }, 1500)
      
    } catch (error) {
      console.error('[DepositPage] Image upload failed:', error)
      setUploadStatus('error')
      setUploadProgress(0)
      
      const errorMessage = error instanceof Error ? error.message : String(error)
      alert(`${t('deposit.imageUploadFailed')}: ${errorMessage}`)
      
      setTimeout(() => {
        setUploadStatus('idle')
      }, 2000)
    } finally {
      setUploading(false)
      // 清空 input，允许重新选择同一文件
      e.target.value = ''
    }
  }

  const handleRemoveImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleUploadClick = () => {
    console.log('[DepositPage] handleUploadClick called, uploading:', uploading)
    if (!uploading && fileInputRef.current) {
      console.log('[DepositPage] Triggering file input click')
      fileInputRef.current.click()
    } else {
      console.log('[DepositPage] Click blocked - uploading:', uploading, 'inputRef:', !!fileInputRef.current)
    }
  }

  const handleSubmit = async () => {
    if (!selectedMethod) {
      alert(t('wallet.pleaseSelectPaymentMethod'))
      return
    }

    const amountNum = parseFloat(amount)
    if (!amountNum || amountNum < selectedMethod.config_data.min_amount) {
      alert(t('wallet.minimumAmount') + ': ' + formatCurrency('TJS', selectedMethod.config_data.min_amount))
      return
    }

    if (amountNum > selectedMethod.config_data.max_amount) {
      alert(t('wallet.maximumAmount') + ': ' + formatCurrency('TJS', selectedMethod.config_data.max_amount))
      return
    }

    // 根据配置检查必填字段
    if (selectedMethod?.require_payer_name && !payerName) {
      alert(t('wallet.pleaseEnterPayerName'))
      return
    }
    if (selectedMethod?.require_payer_account && !payerAccount) {
      alert(t('wallet.pleaseEnterPayerAccount'))
      return
    }
    if (selectedMethod?.require_payer_phone && !payerPhone) {
      alert(t('wallet.pleaseEnterPayerPhone'))
      return
    }

    // 验证是否上传了凭证
    if (!uploadedImages || uploadedImages.length === 0) {
      alert(t('wallet.pleaseUploadProof') || t('deposit.pleaseUploadProof'))
      return
    }

    try {
      setSubmitting(true)

      // 构建请求体（使用 session_token 认证，不再传不安全的 userId）
      const requestBody = {
        session_token: sessionToken,
        amount: amountNum,
        currency: 'TJS',
        paymentMethod: selectedMethod.config_data?.method || selectedMethod.config_key,
        paymentProofImages: uploadedImages,
        ...(selectedMethod?.require_payer_name && { payerName }),
        ...(selectedMethod?.require_payer_account && { payerAccount }),
        ...(selectedMethod?.require_payer_phone && { payerPhone }),
      }
      
      console.log('[DepositPage] 提交充值申请:', JSON.stringify(requestBody))
      console.log('[DepositPage] selectedMethod:', JSON.stringify(selectedMethod))

      const { data, error } = await supabase.functions.invoke('deposit-request', {
        body: requestBody
      })

      if (error) throw new Error(await extractEdgeFunctionError(error))

      if (data?.success) {
        setSuccess(true)
        setTimeout(() => {
          navigate('/wallet')
        }, 2000)
      }
    } catch (error: any) {
      console.error(t('deposit.submitFailed') + ':', error)
      alert(error.message || t('wallet.depositRequestFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const currentLang = i18n.language as 'zh' | 'ru' | 'tg'

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 flex items-center justify-center">
        <div className="text-white text-xl">{t('common.loading')}</div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 text-center max-w-md">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('wallet.depositRequestSubmitted')}</h2>
          <p className="text-gray-600">{t('wallet.pleaseWaitForReview')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 pb-20">
      {/* Header */}
      <div className="bg-white/10 backdrop-blur-md p-4 flex items-center">
        <button onClick={() => navigate(-1)} className="text-white">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white text-xl font-bold ml-4">{t('wallet.deposit')}</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* 选择支付方式 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t('wallet.selectPaymentMethod')}</h2>
          <div className="space-y-2">
            {configs.map((config) => (
              <button
                key={config.id}
                onClick={() => setSelectedMethod(config)}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  selectedMethod?.id === config.id
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-purple-300'
                }`}
              >
                <div className="font-bold text-gray-800">{config.config_data.method}</div>
                {config.config_data.bank_name && (
                  <div className="text-sm text-gray-600">{config.config_data.bank_name}</div>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  {t('wallet.processingTime')}: {config.config_data.processing_time}{t('wallet.minutes')}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 转账信息 */}
        {selectedMethod && (
          <div className="bg-white rounded-2xl p-4">
            <h2 className="text-lg font-bold text-gray-800 mb-4">{t('wallet.transferInfo')}</h2>
            <div className="space-y-3 text-sm">
              {selectedMethod.config_data.account_number && (
                <div>
                  <div className="text-gray-600">{t('wallet.accountNumber')}</div>
                  <div className="font-bold text-gray-800">{selectedMethod.config_data.account_number}</div>
                </div>
              )}
              {selectedMethod.config_data.account_name && (
                <div>
                  <div className="text-gray-600">{t('wallet.accountName')}</div>
                  <div className="font-bold text-gray-800">{selectedMethod.config_data.account_name}</div>
                </div>
              )}
              {selectedMethod.config_data.bank_name && (
                <div>
                  <div className="text-gray-600">{t('wallet.bankName')}</div>
                  <div className="font-bold text-gray-800">{selectedMethod.config_data.bank_name}</div>
                </div>
              )}
              {selectedMethod.config_data.phone_number && (
                <div>
                  <div className="text-gray-600">{t('wallet.phoneNumber')}</div>
                  <div className="font-bold text-gray-800">{selectedMethod.config_data.phone_number}</div>
                </div>
              )}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-4">
                <div className="text-xs text-gray-700 whitespace-pre-line">
                  {selectedMethod.config_data.instructions[currentLang] || selectedMethod.config_data.instructions.zh}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 充值金额 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t('wallet.depositAmount')}</h2>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('wallet.enterAmount')}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-purple-500"
          />
          {selectedMethod && (
            <div className="text-xs text-gray-500 mt-2">
              {t('wallet.amountRange')}: {formatCurrency('TJS', selectedMethod.config_data.min_amount)} - {formatCurrency('TJS', selectedMethod.config_data.max_amount)}
            </div>
          )}
        </div>

        {/* 付款人信息 - 根据配置动态显示 */}
        {(selectedMethod?.require_payer_name || selectedMethod?.require_payer_account || selectedMethod?.require_payer_phone) && (
          <div className="bg-white rounded-2xl p-4">
            <h2 className="text-lg font-bold text-gray-800 mb-4">{t('wallet.payerInfo')}</h2>
            <div className="space-y-3">
              {selectedMethod?.require_payer_name && (
                <input
                  type="text"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder={t('wallet.payerName')}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-purple-500"
                  required
                />
              )}
              {selectedMethod?.require_payer_account && (
                <input
                  type="text"
                  value={payerAccount}
                  onChange={(e) => setPayerAccount(e.target.value)}
                  placeholder={t('wallet.payerAccount')}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-purple-500"
                  required
                />
              )}
              {selectedMethod?.require_payer_phone && (
                <input
                  type="tel"
                  value={payerPhone}
                  onChange={(e) => setPayerPhone(e.target.value)}
                  placeholder={t('wallet.payerPhone')}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:border-purple-500"
                  required
                />
              )}
            </div>
          </div>
        )}

        {/* 上传凭证 */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t('wallet.uploadProof')}</h2>
          
          {/* 上传区域 - 使用 label 包裹 input 实现更好的移动端兼容 */}
          <label 
            htmlFor="payment-proof-upload"
            className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl transition-all cursor-pointer ${
              uploading 
                ? 'border-purple-500 bg-purple-50' 
                : uploadStatus === 'error'
                ? 'border-red-500 bg-red-50'
                : uploadStatus === 'success'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-300 hover:border-purple-500 hover:bg-purple-50'
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center">
                <Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-2" />
                <span className="text-sm text-purple-600 font-medium">
                  {uploadStatus === 'compressing' && (t('deposit.compressing'))}
                  {uploadStatus === 'uploading' && (t('deposit.uploading'))}
                </span>
                {/* 进度条 */}
                <div className="w-48 h-2 bg-purple-200 rounded-full mt-2 overflow-hidden">
                  <div 
                    className="h-full bg-purple-600 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-xs text-purple-500 mt-1">{uploadProgress}%</span>
              </div>
            ) : uploadStatus === 'success' ? (
              <div className="flex flex-col items-center">
                <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
                <span className="text-sm text-green-600 font-medium">
                  {t('deposit.uploadSuccess')}
                </span>
              </div>
            ) : uploadStatus === 'error' ? (
              <div className="flex flex-col items-center">
                <X className="w-8 h-8 text-red-500 mb-2" />
                <span className="text-sm text-red-600 font-medium">
                  {t('deposit.uploadFailed')}
                </span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-400 mb-2" />
                <span className="text-sm text-gray-600">{t('wallet.clickToUpload')}</span>
                <span className="text-xs text-gray-400 mt-1">{t('deposit.supportedFormats')}</span>
              </>
            )}
            <input
              id="payment-proof-upload"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              onClick={(e) => {
                console.log('[DepositPage] File input clicked')
                // 清空value以允许选择相同文件
                e.currentTarget.value = ''
              }}
              disabled={uploading}
              className="hidden"
            />
          </label>
          
          {/* 已上传的图片预览 */}
          {uploadedImages.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-600">
                  {t('deposit.uploadedImages')} ({uploadedImages.length})
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {uploadedImages.map((img, idx) => (
                  <div key={idx} className="relative group">
                    <img 
                      src={img} 
                      alt={`proof-${idx}`} 
                      style={{ width: '100%', height: '96px', objectFit: 'cover', borderRadius: '0.5rem', border: '1px solid #e5e7eb', maxWidth: 'none' }} 
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveImage(idx)
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 提交按钮 */}
        <button
          onClick={handleSubmit}
          disabled={submitting || uploading}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              {t('common.submitting')}
            </>
          ) : (
            t('wallet.submitDepositRequest')
          )}
        </button>
      </div>
    </div>
    </>
  )
}
