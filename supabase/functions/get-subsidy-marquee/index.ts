import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface DepositRow {
  id: string;
  amount: number | string | null;
  created_at: string;
  user: {
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
  } | null;
}

interface MarqueeItem {
  name: string;
  phone: string;
  amount: number;
  bonus: number;
  source: 'real';
  created_at: string;
}

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 3000;
const MAX_REAL_ITEMS = 12;

function sanitizeName(name: string | null | undefined): string {
  return (name || '')
    .replace(/[0-9_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function isLikelyLocalName(name: string): boolean {
  if (!name) {
    return false;
  }

  if (/test|bonus|admin|user|demo|final/i.test(name)) {
    return false;
  }

  return /^[А-Яа-яЁёӢӣҚқҒғҲҳҶҷӮӯЪъЬь\s'.-]+$/.test(name);
}

function buildDisplayName(user: DepositRow['user']): string | null {
  const firstName = sanitizeName(user?.first_name);
  const lastName = sanitizeName(user?.last_name);

  if (firstName && lastName && isLikelyLocalName(firstName) && isLikelyLocalName(lastName)) {
    return `${firstName} ${lastName.slice(0, 1)}.`;
  }

  if (firstName && isLikelyLocalName(firstName)) {
    return firstName;
  }

  if (lastName && isLikelyLocalName(lastName)) {
    return lastName;
  }

  return null;
}

function maskPhone(phone: string | null | undefined): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 7) {
    return '***';
  }

  const lastTwo = digits.slice(-2);
  const country = digits.startsWith('992') ? '992' : digits.slice(0, Math.min(3, digits.length - 4));
  const prefix = digits.slice(country.length, country.length + 2) || '**';
  const next = digits.slice(country.length + 2, country.length + 3) || '*';

  return `${country}${prefix}${next}***${lastTwo}`;
}

function normalizeAmount(value: number | string | null): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const rounded = Math.round(amount);
  if (rounded < MIN_AMOUNT || rounded > MAX_AMOUNT) {
    return null;
  }

  return rounded;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString();

    const { data, error } = await supabase
      .from('deposit_requests')
      .select(`
        id,
        amount,
        created_at,
        user:users!deposit_requests_user_id_fkey(
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('status', 'APPROVED')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Failed to load approved deposits for marquee:', error);
      return new Response(
        JSON.stringify({ items: [], error: 'Failed to fetch marquee deposits' }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=120, max-age=60, stale-while-revalidate=300',
          },
        },
      );
    }

    const seen = new Set<string>();
    const items: MarqueeItem[] = ((data || []) as DepositRow[])
      .map((row) => {
        const amount = normalizeAmount(row.amount);
        if (!amount) {
          return null;
        }

        const name = buildDisplayName(row.user);
        if (!name) {
          return null;
        }

        const phone = maskPhone(row.user?.phone_number);
        const dedupeKey = `${name}_${phone}_${amount}`;
        if (seen.has(dedupeKey)) {
          return null;
        }
        seen.add(dedupeKey);

        return {
          name,
          phone,
          amount,
          bonus: Math.round(amount * 0.5),
          source: 'real' as const,
          created_at: row.created_at,
        };
      })
      .filter((item): item is MarqueeItem => Boolean(item))
      .slice(0, MAX_REAL_ITEMS);

    return new Response(
      JSON.stringify({
        items,
        constraints: {
          min_amount: MIN_AMOUNT,
          max_amount: MAX_AMOUNT,
          max_items: MAX_REAL_ITEMS,
        },
        updated_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=120, max-age=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Subsidy marquee error:', errMsg);

    return new Response(
      JSON.stringify({ items: [], error: errMsg }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
