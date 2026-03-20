import { http, HttpResponse } from 'msw'

// 模拟 Supabase 认证 API
const SUPABASE_URL = 'https://qcrcgpwlfouqslokwbzl.supabase.co'

export const handlers = [
  // 模拟用户登录
  http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
    return HttpResponse.json({
      access_token: 'mock-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'mock-user-id',
        email: 'test@example.com',
        role: 'authenticated',
      },
    })
  }),

  // 模拟 Supabase RPC 调用
  http.post(`${SUPABASE_URL}/rest/v1/rpc/get_user_profile`, () => {
    return HttpResponse.json({
      id: 'mock-user-id',
      username: 'testuser',
      balance: 1000,
    })
  }),

  // 模拟 Supabase 表查询 (例如：获取市场列表)
  http.get(`${SUPABASE_URL}/rest/v1/market`, ({ request }) => {
    const url = new URL(request.url)
    const select = url.searchParams.get('select')

    if (select === '*') {
      return HttpResponse.json([
        { id: 1, name: 'Market 1', status: 'open' },
        { id: 2, name: 'Market 2', status: 'closed' },
      ])
    }
    return HttpResponse.json([])
  }),
]
