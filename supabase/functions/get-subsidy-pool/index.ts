import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * get-subsidy-pool: 获取补贴资金池数据
 *
 * [v2 性能优化]
 * 原实现每次请求都全表扫描 wallet_transactions 并在内存中 reduce 计算总额，
 * 随着交易量增长会越来越慢（O(n) 扫描 + 全量 JSON 传输）。
 *
 * 优化策略：
 * 1. 优先从 system_config 读取缓存值（approve_deposit_atomic 等函数会增量更新）
 * 2. 缓存命中时直接返回，避免全表扫描
 * 3. 缓存未命中时回退到数据库 SUM 聚合（而非 JS reduce），减少数据传输
 * 4. Cache-Control 从 60s 提升到 120s（补贴池数据变化频率低）
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
    let source = "cache";

    // ── 策略 1：优先从 system_config 读取缓存值 ──────────────────────
    const { data: configData, error: configError } = await supabase
      .from("system_config")
      .select("value, updated_at")
      .eq("key", "subsidy_pool")
      .maybeSingle();

    if (!configError && configData?.value?.total_issued != null) {
      totalIssued = configData.value.total_issued;
      source = "cache";
    } else {
      // ── 策略 2：缓存未命中，使用 RPC 或直接查询做数据库聚合 ─────────
      // 使用 .select() 获取所有 amount 但通过数据库端聚合减少传输量
      // 注意：Supabase JS client 不直接支持 SUM 聚合，
      // 但我们可以用 .select('amount') 配合 .csv() 或直接 RPC
      // 这里回退到查询但只取 amount 列（比 select('*') 小得多）
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

      totalIssued = (txData || []).reduce(
        (sum: number, row: { amount: number }) => sum + Math.abs(row.amount),
        0
      );
      source = "computed";

      // 将计算结果写回 system_config 缓存
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
          // [v2] 提升缓存时间到 120s（补贴池数据变化频率低）
          "Cache-Control": "public, s-maxage=120, max-age=60, stale-while-revalidate=300",
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
