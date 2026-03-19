import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * get-subsidy-pool: 获取补贴资金池数据
 * 
 * 统计已发放的总赠送积分（充值赠送等），
 * 前端用 10,000,000 TJS 减去已发放总额，得到剩余资金池。
 * 
 * 数据来源：wallet_transactions 表中 type 为 BONUS / DEPOSIT_BONUS / FIRST_DEPOSIT_BONUS 的记录
 * 
 * 【修复 C4】移除不存在的 wallet_type 列过滤
 * 【修复 C5】添加 BONUS 类型（process_deposit_with_bonus 实际写入的类型）
 * 改为通过 JOIN wallets 表过滤 LUCKY_COIN 钱包的交易记录
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 【修复】先获取所有 LUCKY_COIN 钱包 ID
    const { data: lcWallets, error: walletError } = await supabase
      .from("wallets")
      .select("id")
      .eq("type", "LUCKY_COIN");

    if (walletError) {
      console.error("Error querying LUCKY_COIN wallets:", walletError);
      return new Response(
        JSON.stringify({ error: "Failed to query wallet data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const lcWalletIds = (lcWallets || []).map((w: { id: string }) => w.id);

    let totalIssued = 0;

    if (lcWalletIds.length > 0) {
      // 统计 LUCKY_COIN 钱包中所有赠送类型的交易总额
      // BONUS: 充值赠送（process_deposit_with_bonus 写入的类型）
      // DEPOSIT_BONUS: 充值赠送（历史兼容）
      // FIRST_DEPOSIT_BONUS: 充值赠送(历史)（已废弃，但历史数据需要统计）
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("amount")
        .in("type", ["BONUS", "DEPOSIT_BONUS", "FIRST_DEPOSIT_BONUS"])
        .in("wallet_id", lcWalletIds);

      if (error) {
        console.error("Error querying subsidy data:", error);
        return new Response(
          JSON.stringify({ error: "Failed to query subsidy data" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 计算已发放总额
      totalIssued = (data || []).reduce((sum: number, row: { amount: number }) => {
        return sum + Math.abs(row.amount);
      }, 0);
    }

    // 资金池总额 10,000,000 TJS
    const TOTAL_POOL = 10_000_000;
    const remaining = Math.max(0, TOTAL_POOL - totalIssued);

    return new Response(
      JSON.stringify({
        total_pool: TOTAL_POOL,
        total_issued: Math.round(totalIssued * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        updated_at: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
          // 缓存60秒，减少频繁查询
          "Cache-Control": "public, max-age=60",
        } 
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
