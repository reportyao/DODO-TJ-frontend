/**
 * PhoneInput - 带国家区号选择的手机号输入组件
 * 
 * 支持国家：塔吉克斯坦(+992)、俄罗斯(+7)、中国(+86)
 * 默认：塔吉克斯坦
 * 
 * 使用方式：
 * <PhoneInput value={phone} onChange={setPhone} />
 * 
 * onChange 回调返回完整手机号（含区号），如 "+992901234567"
 */

import React, { useState, useRef, useEffect } from 'react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

export interface Country {
  code: string      // ISO 2字母代码
  dialCode: string  // 区号（含+）
  name: string      // 显示名称
  flag: string      // emoji 国旗
  placeholder: string // 号码格式提示
  maxLength: number   // 本地号码最大长度（不含区号）
}

export const COUNTRIES: Country[] = [
  {
    code: 'TJ',
    dialCode: '+992',
    name: '塔吉克斯坦',
    flag: '🇹🇯',
    placeholder: '9XX XXX XXXX',
    maxLength: 9,
  },
  {
    code: 'RU',
    dialCode: '+7',
    name: '俄罗斯',
    flag: '🇷🇺',
    placeholder: '9XX XXX XXXX',
    maxLength: 10,
  },
  {
    code: 'CN',
    dialCode: '+86',
    name: '中国',
    flag: '🇨🇳',
    placeholder: '1XX XXXX XXXX',
    maxLength: 11,
  },
]

interface PhoneInputProps {
  /** 完整手机号（含区号），如 "+992901234567" 或 "13246634287" */
  value: string
  onChange: (fullPhone: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  autoComplete?: string
  /** 是否显示label */
  showLabel?: boolean
  label?: string
  required?: boolean
}

/**
 * 从完整手机号解析出国家和本地号码
 */
function parsePhone(fullPhone: string): { country: Country; localNumber: string } {
  const defaultCountry = COUNTRIES[0] // 塔吉克斯坦

  if (!fullPhone) return { country: defaultCountry, localNumber: '' }

  // 尝试匹配各国区号
  for (const country of COUNTRIES) {
    const dialWithoutPlus = country.dialCode.replace('+', '')
    if (fullPhone.startsWith(country.dialCode)) {
      return { country, localNumber: fullPhone.slice(country.dialCode.length) }
    }
    if (fullPhone.startsWith(dialWithoutPlus)) {
      return { country, localNumber: fullPhone.slice(dialWithoutPlus.length) }
    }
  }

  // 无区号前缀：根据号码特征猜测
  if (/^1[3-9]\d{9}$/.test(fullPhone)) {
    // 中国手机号
    return { country: COUNTRIES[2], localNumber: fullPhone }
  }
  if (/^9\d{8}$/.test(fullPhone)) {
    // 塔吉克斯坦手机号（9位）
    return { country: COUNTRIES[0], localNumber: fullPhone }
  }

  return { country: defaultCountry, localNumber: fullPhone }
}

const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
  disabled = false,
  autoComplete = 'tel',
  required = false,
}) => {
  const { country: initialCountry, localNumber: initialLocal } = parsePhone(value)
  const [selectedCountry, setSelectedCountry] = useState<Country>(initialCountry)
  const [localNumber, setLocalNumber] = useState(initialLocal)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 当外部 value 变化时同步（如重置表单）
  useEffect(() => {
    const { country, localNumber: local } = parsePhone(value)
    setSelectedCountry(country)
    setLocalNumber(local)
  }, [value])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCountryChange = (country: Country) => {
    setSelectedCountry(country)
    setDropdownOpen(false)
    // 切换国家时保留已输入的本地号码
    onChange(country.dialCode + localNumber)
  }

  const handleLocalNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 只允许数字和空格
    const raw = e.target.value.replace(/[^\d\s]/g, '')
    setLocalNumber(raw)
    onChange(selectedCountry.dialCode + raw.replace(/\s/g, ''))
  }

  const displayPlaceholder = placeholder ?? selectedCountry.placeholder

  return (
    <div className={`flex rounded-xl border border-gray-200 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
      {/* 国家区号选择器 */}
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1.5 px-3 py-3 bg-gray-50 border-r border-gray-200 hover:bg-gray-100 transition-colors h-full min-w-[90px]"
        >
          <span className="text-lg leading-none">{selectedCountry.flag}</span>
          <span className="text-sm font-medium text-gray-700">{selectedCountry.dialCode}</span>
          <ChevronDownIcon className={`w-3.5 h-3.5 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* 下拉菜单 */}
        {dropdownOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden min-w-[180px]">
            {COUNTRIES.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleCountryChange(country)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left ${
                  selectedCountry.code === country.code ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                }`}
              >
                <span className="text-xl leading-none">{country.flag}</span>
                <div>
                  <div className="text-sm font-medium">{country.name}</div>
                  <div className="text-xs text-gray-400">{country.dialCode}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 手机号输入框 */}
      <input
        type="tel"
        value={localNumber}
        onChange={handleLocalNumberChange}
        placeholder={displayPlaceholder}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        className="flex-1 px-3 py-3 bg-white text-gray-900 placeholder-gray-400 focus:outline-none text-sm"
        inputMode="numeric"
      />
    </div>
  )
}

export default PhoneInput
