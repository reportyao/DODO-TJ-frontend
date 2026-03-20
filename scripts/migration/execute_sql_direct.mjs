import fetch from 'node-fetch';
import fs from 'fs';

const supabaseUrl = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQyMzg1MywiZXhwIjoyMDc3OTk5ODUzfQ.Yqu0OluUMtVC73H_bHC6nCqEtjllzhz2HfltbffF_HA';

async function executeSQL() {
  const sql = fs.readFileSync('create_missing_tables.sql', 'utf8');
  
  console.log('Executing SQL via Supabase REST API...\n');
  
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    const result = await response.text();
    console.log('Response status:', response.status);
    console.log('Response:', result);

    if (response.ok) {
      console.log('\n✅ SQL executed successfully!');
    } else {
      console.log('\n⚠️ Response not OK, but SQL may have executed.');
      console.log('Note: Tables are created with IF NOT EXISTS, so this is safe.');
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nNote: Direct SQL execution via REST API may not be available.');
    console.log('Tables need to be created via Supabase Dashboard SQL Editor.');
  }
}

executeSQL();
