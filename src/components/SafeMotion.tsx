import React, { useRef, useEffect } from 'react'
import { motion, MotionProps } from 'framer-motion'

// 安全的 Motion 组件包装器，防止 DOM 操作冲突
interface SafeMotionProps extends Omit<MotionProps, 'ref'> {
  children: React.ReactNode
  as?: keyof React.JSX.IntrinsicElements
  className?: string
}

const SafeMotion: React.FC<SafeMotionProps> = ({ 
  children, 
  as = 'div',
  className,
  ...motionProps 
}) => {
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 安全的动画属性，移除可能导致DOM冲突的属性
  const safeMotionProps = {
    ...motionProps,
    className,
    // 添加额外的安全检查
    onAnimationStart: (definition: any) => {
      if (!isMountedRef.current) return
      motionProps.onAnimationStart?.(definition)
    },
    onAnimationComplete: (definition: any) => {
      if (!isMountedRef.current) return
      motionProps.onAnimationComplete?.(definition)
    },
    // 在严格模式下减少动画复杂性
    transition: {
      ...motionProps.transition,
      duration: process.env.NODE_ENV === 'development' ? 0.2 : motionProps.transition?.duration
    }
  }

  const MotionComponent = (motion as any)[as]

  return (
    <MotionComponent {...safeMotionProps}>
      {children}
    </MotionComponent>
  )
}

export { SafeMotion, SafeAnimationContainer, SafeAnimationItem }

import { safeAnimationVariants } from './animation'

// 列表动画容器
const SafeAnimationContainer: React.FC<{ 
  children: React.ReactNode; 
  className?: string 
}> = ({ children, className }) => {
  return (
    <SafeMotion
      className={className}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={{
        initial: { opacity: 0 },
        animate: { 
          opacity: 1,
          transition: { staggerChildren: 0.05 }
        },
        exit: { opacity: 0 }
      }}
    >
      {children}
    </SafeMotion>
  )
}

// 安全的列表项动画
const SafeAnimationItem: React.FC<{ 
  children: React.ReactNode; 
  index?: number;
  className?: string;
}> = ({ 
  children, 
  index = 0,
  className
}) => {
  return (
    <SafeMotion
      className={className}
      variants={safeAnimationVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ 
        delay: index * 0.05,
        duration: 0.2 
      }}
    >
      {children}
    </SafeMotion>
  )
}