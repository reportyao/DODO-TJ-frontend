import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * get-subsidy-pool: 获取补贴资金池数据
 * 
 * 优先从 system_config.subsidy_pool 读取已发放总额（实体化补贴池），
 * 如果不存在则回退到动态计算（统计 BONUS 交易总额）。
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
    let totalIssued = 0;
    let source = "dynamic"; // 数据来源标识

    // 优先从 system_config 读取实体化的补贴池数据
    const { data: configData, error: configError } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "subsidy_pool")
      .single();

    if (!configError && configData?.value?.total_issued !== undefined) {
      totalIssued = Number(configData.value.total_issued);
      source = "config";
    } else {
      // 回退：动态计算（统计 LUCKY_COIN 钱包中所有 BONUS 交易）
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

      if (lcWalletIds.length > 0) {
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

        totalIssued = (data || []).reduce((sum: number, row: { amount: number }) => {
          return sum + Math.abs(row.amount);
        }, 0);
      }
    }

    const remaining = Math.max(0, TOTAL_POOL - totalIssued);

    return new Response(
      JSON.stringify({
        total_pool: TOTAL_POOL,
        total_issued: Math.round(totalIssued * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        source,
        updated_at: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/json",
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
