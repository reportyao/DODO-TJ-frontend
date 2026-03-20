import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQyMzg1MywiZXhwIjoyMDc3OTk5ODUzfQ.Yqu0OluUMtVC73H_bHC6nCqEtjllzhz2HfltbffF_HA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTableColumns(tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (error) {
      console.log(`❌ Table ${tableName}: Error - ${error.message}`);
      return null;
    }
    
    if (!data || data.length === 0) {
      // Try to get structure by inserting invalid data
      const { error: insertError } = await supabase
        .from(tableName)
        .insert({ __test_column__: 'test' });
      
      if (insertError && insertError.message) {
        // Extract column names from error message
        console.log(`✅ Table ${tableName}: Exists (empty)`);
        return {};
      }
    } else {
      console.log(`✅ Table ${tableName}: Exists with ${Object.keys(data[0]).length} columns`);
      console.log(`   Columns: ${Object.keys(data[0]).join(', ')}`);
      return data[0];
    }
  } catch (error) {
    console.log(`❌ Table ${tableName}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('=== DATABASE TABLE MAPPING CHECK ===\n');
  
  const tables = [
    // Core tables
    'users',
    'user_sessions',
    'wallets',
    'wallet_transactions',
    
    // Lottery tables
    'lotteries',
    'tickets',
    'lottery_entries',
    'orders',
    'prizes',
    'lottery_results',
    
    // Resale tables
    'resales',
    'resale_items',
    'resale_listings',
    
    // Transaction tables
    'transactions',
    'exchange_records',
    'commissions',
    
    // Deposit/Withdraw tables
    'deposits',
    'withdrawals',
    'payment_configs',
    
    // Social tables
    'showoffs',
    'likes',
    'notifications',
    
    // Shipping tables
    'shipping',
    'shipping_addresses',
    
    // Admin tables
    'admins',
    'admin_logs',
    'permissions',
    'roles'
  ];
  
  for (const table of tables) {
    await checkTableColumns(table);
  }
  
  console.log('\n=== CHECKING FOREIGN KEY RELATIONSHIPS ===\n');
  
  // Check lottery -> winning_user_id relationship
  const { data: lotteryWithUser, error: lotteryError } = await supabase
    .from('lotteries')
    .select('id, winning_user_id, users:winning_user_id(telegram_username)')
    .eq('status', 'COMPLETED')
    .limit(1);
  
  if (lotteryError) {
    console.log('❌ lotteries -> users (winning_user_id): Error -', lotteryError.message);
  } else {
    console.log('✅ lotteries -> users (winning_user_id): OK');
  }
  
  // Check tickets -> user relationship
  const { data: ticketsWithUser, error: ticketsError } = await supabase
    .from('tickets')
    .select('id, user_id, users:user_id(telegram_username)')
    .limit(1);
  
  if (ticketsError) {
    console.log('❌ tickets -> users: Error -', ticketsError.message);
  } else {
    console.log('✅ tickets -> users: OK');
  }
  
  // Check prizes -> lottery relationship
  const { data: prizesWithLottery, error: prizesError } = await supabase
    .from('prizes')
    .select('id, lottery_id, lotteries:lottery_id(period, title)')
    .limit(1);
  
  if (prizesError) {
    console.log('❌ prizes -> lotteries: Error -', prizesError.message);
  } else {
    console.log('✅ prizes -> lotteries: OK');
  }
  
  // Check resales -> seller/buyer relationship
  const { data: resalesWithUsers, error: resalesError } = await supabase
    .from('resales')
    .select('id, seller_id, buyer_id, seller:seller_id(telegram_username), buyer:buyer_id(telegram_username)')
    .limit(1);
  
  if (resalesError) {
    console.log('❌ resales -> users (seller/buyer): Error -', resalesError.message);
  } else {
    console.log('✅ resales -> users (seller/buyer): OK');
  }
}

main().catch(console.error);
