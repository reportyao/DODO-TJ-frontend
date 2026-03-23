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
 *
 * 注意：下拉菜单通过 Portal 渲染到 document.body，
 * 避免被父容器的 overflow-hidden 裁剪。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

export interface Country {
  code: string
  dialCode: string
  name: string
  flag: string
  placeholder: string
  maxLength: number
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

  // 尝试匹配各国区号（从长到短，避免 +7 匹配到 +992 的情况）
  const sorted = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length)
  for (const country of sorted) {
    if (fullPhone.startsWith(country.dialCode)) {
      return { country, localNumber: fullPhone.slice(country.dialCode.length) }
    }
    const dialWithoutPlus = country.dialCode.replace('+', '')
    if (fullPhone.startsWith(dialWithoutPlus)) {
      return { country, localNumber: fullPhone.slice(dialWithoutPlus.length) }
    }
  }

  // 无区号前缀：根据号码特征猜测
  if (/^1[3-9]\d{9}$/.test(fullPhone)) {
    return { country: COUNTRIES[2], localNumber: fullPhone } // 中国
  }
  if (/^9\d{8}$/.test(fullPhone)) {
    return { country: COUNTRIES[0], localNumber: fullPhone } // 塔吉克斯坦
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
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 当外部 value 变化时同步（如重置表单）
  useEffect(() => {
    const { country, localNumber: local } = parsePhone(value)
    setSelectedCountry(country)
    setLocalNumber(local)
  }, [value])

  // 计算下拉菜单位置（Portal 模式需要手动定位）
  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: 180,
      zIndex: 9999,
    })
  }, [])

  // 打开下拉时计算位置
  const handleToggleDropdown = () => {
    if (disabled) return
    if (!dropdownOpen) {
      updateDropdownPosition()
    }
    setDropdownOpen((prev) => !prev)
  }

  // 点击外部关闭下拉
  useEffect(() => {
    if (!dropdownOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setDropdownOpen(false)
      }
    }

    // 滚动时关闭下拉
    const handleScroll = () => setDropdownOpen(false)

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [dropdownOpen])

  const handleCountryChange = (country: Country) => {
    setSelectedCountry(country)
    setDropdownOpen(false)
    onChange(country.dialCode + localNumber)
  }

  const handleLocalNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d\s]/g, '')
    setLocalNumber(raw)
    onChange(selectedCountry.dialCode + raw.replace(/\s/g, ''))
  }

  const displayPlaceholder = placeholder ?? selectedCountry.placeholder

  return (
    <div
      className={`flex rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {/* 国家区号触发按钮 */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggleDropdown}
        className="flex items-center gap-1.5 px-3 py-3 bg-gray-50 border-r border-gray-200 hover:bg-gray-100 active:bg-gray-200 transition-colors rounded-l-xl flex-shrink-0 min-w-[96px] select-none"
      >
        <span className="text-lg leading-none">{selectedCountry.flag}</span>
        <span className="text-sm font-medium text-gray-700">{selectedCountry.dialCode}</span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 下拉菜单（Portal 渲染，不受父容器 overflow 影响） */}
      {dropdownOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          >
            {COUNTRIES.map((country) => (
              <button
                key={country.code}
                type="button"
                onMouseDown={(e) => {
                  // 阻止 blur 触发 clickOutside 关闭
                  e.preventDefault()
                  handleCountryChange(country)
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50 active:bg-amber-100 transition-colors text-left ${
                  selectedCountry.code === country.code
                    ? 'bg-amber-50 text-primary-dark'
                    : 'text-gray-700'
                }`}
              >
                <span className="text-xl leading-none">{country.flag}</span>
                <div>
                  <div className="text-sm font-medium">{country.name}</div>
                  <div className="text-xs text-gray-400">{country.dialCode}</div>
                </div>
              </button>
            ))}
          </div>,
          document.body
        )}

      {/* 手机号输入框 */}
      <input
        type="tel"
        value={localNumber}
        onChange={handleLocalNumberChange}
        placeholder={displayPlaceholder}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        className="flex-1 px-3 py-3 bg-white text-gray-900 placeholder-gray-400 focus:outline-none text-sm rounded-r-xl"
        inputMode="numeric"
      />
    </div>
  )
}

export default PhoneInput
