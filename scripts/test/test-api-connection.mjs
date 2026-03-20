#!/usr/bin/env node

/**
 * 测试 API 连接和数据获取
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MjM4NTMsImV4cCI6MjA3Nzk5OTg1M30.xsdiUmVfN9Cwa7jkusYubs4ZI34ZpYSdD_nsAB_X2w0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('\n🔗 测试 API 连接和数据获取\n');
console.log('═══════════════════════════════════════════════════\n');

async function testConnection() {
  console.log('📡 1. 测试 Supabase 连接...');
  try {
    const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
    if (error) {
      console.log(`   ❌ 连接失败: ${error.message}`);
      return false;
    }
    console.log(`   ✅ 连接成功`);
    return true;
  } catch (e) {
    console.log(`   ❌ 异常: ${e.message}`);
    return false;
  }
}

async function testUserData() {
  console.log('\n👤 2. 测试用户数据获取...');
  try {
    // 创建或获取测试用户
    const testTelegramId = '12345678';
    
    // 先查找用户
    const { data: existingUsers, error: searchError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', testTelegramId)
      .limit(1);
    
    if (searchError) {
      console.log(`   ❌ 查询失败: ${searchError.message}`);
      return;
    }
    
    if (existingUsers && existingUsers.length > 0) {
      const user = existingUsers[0];
      console.log(`   ✅ 找到用户:`);
      console.log(`      - ID: ${user.id}`);
      console.log(`      - Telegram ID: ${user.telegram_id}`);
      console.log(`      - Username: ${user.username || 'N/A'}`);
      console.log(`      - 邀请码: ${user.referral_code || 'N/A'}`);
      console.log(`      - 余额: ${user.balance || 0}`);
      console.log(`      - 抽奖币: ${user.lottery_coins || 0}`);
    } else {
      console.log(`   ⚠️  未找到测试用户 (Telegram ID: ${testTelegramId})`);
      console.log(`   提示: 用户首次登录时会自动创建`);
    }
  } catch (e) {
    console.log(`   ❌ 异常: ${e.message}`);
  }
}

async function testLotteryData() {
  console.log('\n🎁 3. 测试抽奖数据获取...');
  try {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('status', 'ACTIVE')
      .limit(5);
    
    if (error) {
      console.log(`   ❌ 查询失败: ${error.message}`);
      return;
    }
    
    if (data && data.length > 0) {
      console.log(`   ✅ 找到 ${data.length} 个活跃抽奖:`);
      data.forEach((lottery, index) => {
        console.log(`      ${index + 1}. ${lottery.title || lottery.id}`);
        console.log(`         价格: ${lottery.price || lottery.ticket_price || 'N/A'}`);
        console.log(`         总票数: ${lottery.total_tickets || 'N/A'}`);
      });
    } else {
      console.log(`   ⚠️  没有找到活跃的抽奖`);
    }
  } catch (e) {
    console.log(`   ❌ 异常: ${e.message}`);
  }
}

async function testNetworkAccess() {
  console.log('\n🌐 4. 测试网络访问...');
  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/', {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    
    console.log(`   状态码: ${response.status}`);
    console.log(`   ✅ API 端点可访问`);
    
    // 测试 CORS
    const corsHeaders = {
      'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
      'access-control-allow-methods': response.headers.get('access-control-allow-methods')
    };
    
    if (corsHeaders['access-control-allow-origin']) {
      console.log(`   ✅ CORS 已启用: ${corsHeaders['access-control-allow-origin']}`);
    } else {
      console.log(`   ⚠️  CORS 头未找到`);
    }
  } catch (e) {
    console.log(`   ❌ 网络错误: ${e.message}`);
  }
}

async function testTelegramAuth() {
  console.log('\n🔐 5. Telegram 认证说明...');
  console.log(`   在 Telegram WebApp 中，用户认证流程:`);
  console.log(`   1. Telegram 提供 initData (包含用户信息)`);
  console.log(`   2. 前端发送 initData 到后端验证`);
  console.log(`   3. 后端验证签名并创建/更新用户`);
  console.log(`   4. 返回用户 UID 和邀请码`);
  console.log(``);
  console.log(`   如果看到"网络错误"，可能的原因:`);
  console.log(`   - Supabase Edge Function 未部署`);
  console.log(`   - Telegram initData 验证失败`);
  console.log(`   - CORS 配置问题`);
}

async function main() {
  const connected = await testConnection();
  if (!connected) {
    console.log('\n❌ 无法连接到数据库，请检查 Supabase 配置\n');
    return;
  }
  
  await testUserData();
  await testLotteryData();
  await testNetworkAccess();
  await testTelegramAuth();
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('\n✅ 测试完成\n');
  console.log('💡 建议:');
  console.log('  1. 确保 Supabase Edge Functions 已部署');
  console.log('  2. 检查 Telegram Bot Webhook 配置');
  console.log('  3. 在 Telegram 中清除缓存后重新打开');
  console.log('  4. 查看浏览器控制台的详细错误信息\n');
}

main();
