import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * get-subsidy-pool: 获取补贴资金池数据
 *
 * 策略：动态计算为主（直接统计 wallet_transactions 中的 BONUS 交易总额），
 * 确保数据始终准确。同时将计算结果同步写回 system_config，
 * 供 approve_deposit_atomic 等函数做增量累加的基准。
 *
 * 前端用 total_pool 减去 total_issued 得到剩余资金池。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const TOTAL_POOL = 10_000_000;

    // ── 动态计算：统计所有 BONUS 类型交易的总额 ──────────────────────────
    // 直接按 type 过滤，不限制 wallet 类型，确保覆盖所有补贴发放场景
    const { data: txData, error: txError } = await supabase
      .from("wallet_transactions")
      .select("amount")
      .in("type", ["BONUS", "DEPOSIT_BONUS", "FIRST_DEPOSIT_BONUS"]);

    if (txError) {
      console.error("Error querying bonus transactions:", txError);
      return new Response(
        JSON.stringify({ error: "Failed to query bonus transactions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalIssued = (txData || []).reduce(
      (sum: number, row: { amount: number }) => sum + Math.abs(row.amount),
      0
    );

    // ── 将最新值同步写回 system_config，保持缓存一致 ─────────────────────
    // 使用 upsert，确保 approve_deposit_atomic 的增量累加基准始终正确
    await supabase
      .from("system_config")
      .upsert(
        {
          key: "subsidy_pool",
          value: { total_pool: TOTAL_POOL, total_issued: totalIssued },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    const remaining = Math.max(0, TOTAL_POOL - totalIssued);

    return new Response(
      JSON.stringify({
        total_pool: TOTAL_POOL,
        total_issued: Math.round(totalIssued * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        source: "dynamic",
        updated_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      }
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("Subsidy pool error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
