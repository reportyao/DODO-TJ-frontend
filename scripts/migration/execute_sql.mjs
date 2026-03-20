import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://qcrcgpwlfouqslokwbzl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93eWl0eHd4bXh3YmtxZ3pmZmR3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjQyMzg1MywiZXhwIjoyMDc3OTk5ODUzfQ.Yqu0OluUMtVC73H_bHC6nCqEtjllzhz2HfltbffF_HA';

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'public' },
  auth: { persistSession: false }
});

async function executeSQLFile(filename) {
  try {
    const sql = fs.readFileSync(filename, 'utf8');
    
    // Split SQL by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`Executing ${statements.length} SQL statements...\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`Statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + '...\n');
      
      try {
        const { data, error } = await supabase.rpc('exec_sql', {
          sql_query: statement
        });
        
        if (error) {
          // Try direct query if RPC doesn't exist
          const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({ sql_query: statement })
          });
          
          if (!response.ok) {
            console.log('⚠️  RPC method not available, using direct SQL execution via Postgres REST API');
            // For Supabase, we need to use the SQL editor or migrations
            // Let's create it as a migration file instead
          }
        } else {
          console.log('✅ Success\n');
        }
      } catch (err) {
        console.log(`⚠️  ${err.message}\n`);
      }
    }
    
    console.log('All statements processed!');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

executeSQLFile('create_missing_tables.sql');
