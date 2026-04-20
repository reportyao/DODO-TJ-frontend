
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcmNncHdsZm91cXNsb2t3YnpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMzMzNywiZXhwIjoyMDg5NTA5MzM3fQ.CB4qQc2gXjZA_LEJG3J2GgMsd0Z1Cr5speVpV3IhRrM';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runTest() {
  console.log('🚀 Starting E2E Lottery Lifecycle Test...');

  // 1. 创建测试商品
  const lotteryId = `test-lottery-${Date.now()}`;
  const { error: createError } = await supabase.from('lotteries').insert({
    id: lotteryId,
    title: { zh: 'E2E 测试商品' },
    ticket_price: 1,
    total_tickets: 2,
    sold_tickets: 0,
    status: 'ACTIVE',
    start_time: new Date().toISOString(),
    currency: 'TJS',
    period: '1',
    image_url: 'https://example.com/image.png'
  });

  if (createError) {
    console.error('❌ Failed to create test lottery:', createError);
    return;
  }
  console.log('✅ Created test lottery:', lotteryId);

  // 2. 模拟用户购买（购买 1 份）
  const userId = '7d8c5f0e-2302-496e-bb7c-41317775a419'; // 使用真实用户 ID
  const { error: buy1Error } = await supabase.from('lottery_entries').insert({
    lottery_id: lotteryId,
    user_id: userId,
    participation_code: '1000001',
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  });
  await supabase.from('lotteries').update({ sold_tickets: 1 }).eq('id', lotteryId);

  if (buy1Error) {
    console.error('❌ Failed to buy first ticket:', buy1Error);
    return;
  }
  console.log('✅ Bought first ticket');

  // 3. 模拟用户购买（购买最后 1 份，触发售罄）
  const { error: buy2Error } = await supabase.from('lottery_entries').insert({
    lottery_id: lotteryId,
    user_id: userId,
    participation_code: '1000002',
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  });
  await supabase.from('lotteries').update({ sold_tickets: 2 }).eq('id', lotteryId);

  if (buy2Error) {
    console.error('❌ Failed to buy second ticket:', buy2Error);
    return;
  }
  console.log('✅ Bought second ticket (Sold Out)');

  // 4. 调用 check-lottery-sold-out 触发状态变更
  console.log('⏳ Triggering check-lottery-sold-out...');
  const checkResp = await fetch(`${SUPABASE_URL}/functions/v1/check-lottery-sold-out`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ lotteryId })
  });
  const checkResult = await checkResp.json();
  console.log('Result:', checkResult);

  // 5. 验证状态是否变为 SOLD_OUT 且设置了 draw_time
  const { data: lotteryAfterSoldOut } = await supabase.from('lotteries').select('*').eq('id', lotteryId).single();
  if (lotteryAfterSoldOut?.status === 'SOLD_OUT' && lotteryAfterSoldOut?.draw_time) {
    console.log('✅ Lottery status is SOLD_OUT and draw_time is set:', lotteryAfterSoldOut.draw_time);
  } else {
    console.error('❌ Lottery status or draw_time incorrect:', lotteryAfterSoldOut);
    return;
  }

  // 6. 强制修改 draw_time 为过去，模拟时间到达
  await supabase.from('lotteries').update({ draw_time: new Date(Date.now() - 1000).toISOString() }).eq('id', lotteryId);
  console.log('✅ Forced draw_time to past');

  // 7. 调用 scheduled-lottery-draw 触发开奖
  console.log('⏳ Triggering scheduled-lottery-draw...');
  const drawResp = await fetch(`${SUPABASE_URL}/functions/v1/scheduled-lottery-draw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const drawResult = await drawResp.json();
  console.log('Result:', drawResult);

  // 8. 验证最终结果
  const { data: finalLottery } = await supabase.from('lotteries').select('*').eq('id', lotteryId).single();
  const { data: prize } = await supabase.from('prizes').select('*').eq('lottery_id', lotteryId).single();
  const { data: result } = await supabase.from('lottery_results').select('*').eq('lottery_id', lotteryId).single();

  if (finalLottery?.status === 'COMPLETED' && finalLottery?.winning_user_id && prize && result) {
    console.log('🎉 SUCCESS! Lottery completed, winner selected, prize and result records created.');
    console.log('Winner:', finalLottery.winning_user_id);
    console.log('Winning Number:', finalLottery.winning_ticket_number);
  } else {
    console.error('❌ Final verification failed:');
    console.log('Lottery:', finalLottery);
    console.log('Prize:', prize);
    console.log('Result:', result);
  }

  // 9. 清理测试数据
  console.log('🧹 Cleaning up test data...');
  await supabase.from('prizes').delete().eq('lottery_id', lotteryId);
  await supabase.from('lottery_results').delete().eq('lottery_id', lotteryId);
  await supabase.from('lottery_entries').delete().eq('lottery_id', lotteryId);
  await supabase.from('lotteries').delete().eq('id', lotteryId);
  console.log('✅ Cleanup complete.');
}

runTest();
