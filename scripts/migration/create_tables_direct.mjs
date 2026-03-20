import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQyMzg1MywiZXhwIjoyMDc3OTk5ODUzfQ.Yqu0OluUMtVC73H_bHC6nCqEtjllzhz2HfltbffF_HA';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
  console.log('Checking if tables exist...\n');
  
  // Check deposits
  const { data: deposits, error: depositsError } = await supabase
    .from('deposits')
    .select('id')
    .limit(1);
  
  if (depositsError) {
    console.log('❌ deposits table does not exist');
    console.log('   Error:', depositsError.message);
  } else {
    console.log('✅ deposits table exists');
  }
  
  // Check withdrawals
  const { data: withdrawals, error: withdrawalsError } = await supabase
    .from('withdrawals')
    .select('id')
    .limit(1);
  
  if (withdrawalsError) {
    console.log('❌ withdrawals table does not exist');
    console.log('   Error:', withdrawalsError.message);
  } else {
    console.log('✅ withdrawals table exists');
  }
  
  // Check payment_configs
  const { data: paymentConfigs, error: paymentConfigsError } = await supabase
    .from('payment_configs')
    .select('id')
    .limit(1);
  
  if (paymentConfigsError) {
    console.log('❌ payment_configs table does not exist');
    console.log('   Error:', paymentConfigsError.message);
  } else {
    console.log('✅ payment_configs table exists');
  }
  
  console.log('\n⚠️  Note: Tables need to be created via Supabase Dashboard SQL Editor');
  console.log('    or using supabase CLI migrations.');
  console.log('\n    SQL file created at: create_missing_tables.sql');
  console.log('    Migration file created at: supabase/migrations/');
}

checkTables();
