import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../contexts/UserContext'
import { PageLoadingFallback } from './PageLoadingFallback'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * 认证守卫组件
 * 
 * 包裹需要登录才能访问的路由。
 * - 如果用户已登录，正常渲染子组件
 * - 如果正在加载认证状态，显示 loading
 * - 如果用户未登录，重定向到登录页，并携带当前路径作为 redirect 参数
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useUser()
  const location = useLocation()

  // 正在检查 session，显示加载状态
  if (isLoading) {
    return <PageLoadingFallback />
  }

  // 未登录，重定向到登录页
  if (!isAuthenticated) {
    const redirectPath = location.pathname + location.search
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirectPath)}`} replace />
  }

  // 已登录，渲染子组件
  return <>{children}</>
}

/**
 * 访客守卫组件
 * 
 * 包裹登录/注册等页面。
 * - 如果用户已登录，重定向到首页
 * - 如果用户未登录，正常渲染子组件
 */
export const GuestGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useUser()

  // 正在检查 session，显示加载状态
  if (isLoading) {
    return <PageLoadingFallback />
  }

  // 已登录，重定向到首页
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  // 未登录，渲染子组件
  return <>{children}</>
}

export default AuthGuard
