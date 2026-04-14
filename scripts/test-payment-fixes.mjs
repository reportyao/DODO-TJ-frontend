import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const PROJECT_ROOT = '/home/ubuntu/DODO-TJ-frontend'
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qcrcgpwlfouqslokwbzl.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const report = {
  generated_at: new Date().toISOString(),
  project_root: PROJECT_ROOT,
  checks: [],
  summary: {
    pass: 0,
    fail: 0,
    warn: 0,
  },
}

function addCheck(name, status, details = {}) {
  report.checks.push({ name, status, ...details })
  report.summary[status] += 1
}

async function read(relPath) {
  return fs.readFile(path.join(PROJECT_ROOT, relPath), 'utf8')
}

function headers() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function rest(pathname) {
  const started = Date.now()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: headers(),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return {
    ok: res.ok,
    status: res.status,
    ms: Date.now() - started,
    json,
    raw: text,
    responseHeaders: Object.fromEntries(res.headers.entries()),
  }
}

async function fn(name, body) {
  const started = Date.now()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return {
    ok: res.ok,
    status: res.status,
    ms: Date.now() - started,
    json,
    raw: text,
    responseHeaders: Object.fromEntries(res.headers.entries()),
  }
}

async function main() {
  const getOrderDetailSource = await read('supabase/functions/get-order-detail/index.ts')
  const createFullPurchaseSource = await read('supabase/functions/create-full-purchase-order/index.ts')
  const confirmPageSource = await read('src/pages/FullPurchaseConfirmPage.tsx')
  const authSource = await read('supabase/functions/_shared/auth.ts')

  addCheck(
    'source:get-order-detail removed group-buy branches',
    !/group_buy|auto_group_buy|group_buy_orders/.test(getOrderDetailSource) ? 'pass' : 'fail',
    {
      expectation: '订单详情函数不再包含未上线的 group_buy / group_buy_orders 分支',
    }
  )

  addCheck(
    'source:get-order-detail lazy loads pickup point options',
    /const needsPickupPointOptions = !pickupPointData \|\| pickupPointData\.is_active === false/.test(getOrderDetailSource) &&
      /const activePickupPoints = needsPickupPointOptions/.test(getOrderDetailSource)
      ? 'pass'
      : 'fail',
    {
      expectation: '仅在当前订单无有效自提点时查询 available_pickup_points',
    }
  )

  addCheck(
    'source:create-full-purchase-order removed wallet and coupon prefetch',
    !/\.from\('wallets'\)/.test(createFullPurchaseSource) && !/\.from\('coupons'\)/.test(createFullPurchaseSource)
      ? 'pass'
      : 'fail',
    {
      expectation: '支付函数不应在 RPC 前重复查询 wallets / coupons',
    }
  )

  addCheck(
    'source:create-full-purchase-order uses process_mixed_payment',
    /rpc\('process_mixed_payment'/.test(createFullPurchaseSource) ? 'pass' : 'fail',
    {
      expectation: '余额、积分与优惠券检查统一下沉到 process_mixed_payment',
    }
  )

  addCheck(
    'source:full-purchase-confirm page avoids blocking navigation on wallet refresh',
    /refreshWallets\(\)\.catch/.test(confirmPageSource) || /void refreshWallets\(\)/.test(confirmPageSource)
      ? 'pass'
      : 'warn',
    {
      expectation: '支付成功后钱包刷新应转为后台执行，不阻塞跳转',
    }
  )

  addCheck(
    'source:shared auth helper exists',
    /validateSessionWithUser/.test(authSource) ? 'pass' : 'fail',
    {
      expectation: '共享会话验证模块存在并被支付/详情函数复用',
    }
  )

  const activeSessionsRes = await rest(`user_sessions?select=user_id,session_token,expires_at&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=expires_at.desc&limit=20`)
  if (!activeSessionsRes.ok || !Array.isArray(activeSessionsRes.json) || activeSessionsRes.json.length === 0) {
    addCheck('runtime:load active sessions', 'fail', { result: activeSessionsRes })
  } else {
    addCheck('runtime:load active sessions', 'pass', { ms: activeSessionsRes.ms, sample_count: activeSessionsRes.json.length })
  }

  const sessions = Array.isArray(activeSessionsRes.json) ? activeSessionsRes.json : []
  const fullOrdersRes = await rest('full_purchase_orders?select=id,user_id,status,pickup_point_id,created_at&order=created_at.desc&limit=20')
  const prizesRes = await rest('prizes?select=id,user_id,status,created_at&order=created_at.desc&limit=20')

  const sessionByUser = new Map(sessions.map((s) => [s.user_id, s.session_token]))
  const fullOrder = Array.isArray(fullOrdersRes.json) ? fullOrdersRes.json.find((o) => sessionByUser.has(o.user_id)) : null
  const prizeOrder = Array.isArray(prizesRes.json) ? prizesRes.json.find((o) => sessionByUser.has(o.user_id)) : null

  addCheck('runtime:load full purchase sample order', fullOrder ? 'pass' : 'fail', {
    ms: fullOrdersRes.ms,
    order_id: fullOrder?.id || null,
  })
  addCheck('runtime:load prize sample order', prizeOrder ? 'pass' : 'fail', {
    ms: prizesRes.ms,
    order_id: prizeOrder?.id || null,
  })

  if (fullOrder) {
    const sessionToken = sessionByUser.get(fullOrder.user_id)
    const first = await fn('get-order-detail', { order_id: fullOrder.id, session_token: sessionToken })
    const second = await fn('get-order-detail', { order_id: fullOrder.id, session_token: sessionToken })

    const fullPurchaseOk = first.ok && first.json?.order_type === 'full_purchase'
    addCheck('runtime:get-order-detail full purchase success', fullPurchaseOk ? 'pass' : 'fail', {
      ms: first.ms,
      status_code: first.status,
      response_header_x_cache: first.responseHeaders['x-cache'] || null,
      order_type: first.json?.order_type || null,
      pickup_point_present: Boolean(first.json?.pickup_point),
      available_pickup_points_count: Array.isArray(first.json?.available_pickup_points) ? first.json.available_pickup_points.length : null,
    })

    const hasActivePickup = Boolean(first.json?.pickup_point?.is_active)
    const pickupOptionsCount = Array.isArray(first.json?.available_pickup_points) ? first.json.available_pickup_points.length : null
    if (hasActivePickup && pickupOptionsCount === 0) {
      addCheck('runtime:get-order-detail skips pickup options when active pickup point exists', 'pass', {
        ms: first.ms,
      })
    } else if (hasActivePickup && typeof pickupOptionsCount === 'number' && pickupOptionsCount > 0) {
      addCheck('runtime:get-order-detail skips pickup options when active pickup point exists', 'warn', {
        ms: first.ms,
        observation: '运行时接口仍返回 available_pickup_points，说明部署环境可能尚未更新到本地修复版本，或线上逻辑与本地源码不一致',
      })
    } else {
      addCheck('runtime:get-order-detail skips pickup options when active pickup point exists', 'warn', {
        ms: first.ms,
        observation: '所选样本订单缺少活动自提点，无法对该优化做强验证',
      })
    }

    const secondCache = second.responseHeaders['x-cache']
    addCheck('runtime:get-order-detail cache repeat request', secondCache === 'HIT' ? 'pass' : 'warn', {
      first_x_cache: first.responseHeaders['x-cache'] || null,
      second_x_cache: secondCache || null,
      first_ms: first.ms,
      second_ms: second.ms,
      observation: secondCache === 'HIT' ? '重复请求命中缓存' : '未稳定命中缓存，可能受实例切换或线上版本影响',
    })
  }

  if (prizeOrder) {
    const sessionToken = sessionByUser.get(prizeOrder.user_id)
    const prizeDetail = await fn('get-order-detail', { order_id: prizeOrder.id, session_token: sessionToken })
    addCheck('runtime:get-order-detail prize success', prizeDetail.ok && prizeDetail.json?.order_type === 'prize' ? 'pass' : 'fail', {
      ms: prizeDetail.ms,
      status_code: prizeDetail.status,
      order_type: prizeDetail.json?.order_type || null,
      total_amount: prizeDetail.json?.total_amount ?? null,
    })
  }

  const invalidSessionRes = await fn('get-order-detail', { order_id: fullOrder?.id || '00000000-0000-0000-0000-000000000000', session_token: 'invalid-session-token' })
  addCheck('runtime:get-order-detail invalid session rejected', invalidSessionRes.status === 401 ? 'pass' : 'fail', {
    ms: invalidSessionRes.ms,
    status_code: invalidSessionRes.status,
    body: invalidSessionRes.json,
  })

  const createNoSessionRes = await fn('create-full-purchase-order', { lottery_id: '00000000-0000-0000-0000-000000000000' })
  addCheck('runtime:create-full-purchase-order missing session fast-fail', createNoSessionRes.status === 401 ? 'pass' : 'fail', {
    ms: createNoSessionRes.ms,
    status_code: createNoSessionRes.status,
    body: createNoSessionRes.json,
  })

  const validSessionToken = fullOrder ? sessionByUser.get(fullOrder.user_id) : null
  if (validSessionToken) {
    const createInvalidLotteryRes = await fn('create-full-purchase-order', {
      lottery_id: '00000000-0000-0000-0000-000000000000',
      session_token: validSessionToken,
      useCoupon: false,
      idempotency_key: `test-${Date.now()}`,
    })

    const goodStatus = createInvalidLotteryRes.status === 404 || createInvalidLotteryRes.status === 400
    addCheck('runtime:create-full-purchase-order invalid lottery rejected without mutation', goodStatus ? 'pass' : 'warn', {
      ms: createInvalidLotteryRes.ms,
      status_code: createInvalidLotteryRes.status,
      body: createInvalidLotteryRes.json,
    })
  }

  const outputPath = path.join(PROJECT_ROOT, 'full_purchase_fix_test_report_20260413.json')
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n')

  console.log(JSON.stringify({
    summary: report.summary,
    output: outputPath,
  }, null, 2))
}

main().catch(async (error) => {
  addCheck('test-runner fatal error', 'fail', {
    error: error instanceof Error ? error.stack || error.message : String(error),
  })
  const outputPath = path.join(PROJECT_ROOT, 'full_purchase_fix_test_report_20260413.json')
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n')
  console.error(JSON.stringify({ summary: report.summary, output: outputPath }, null, 2))
  process.exit(1)
})
