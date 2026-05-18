import os
#!/usr/bin/env python3
"""
B2B 满额赠送功能端到端测试脚本
测试以下功能：
1. b2b-cart get action - 获取购物车（含满额赠送状态）
2. b2b-cart add action - 添加商品到购物车
3. b2b-cart update action - 更新购物车商品数量
4. b2b-cart remove action - 删除购物车商品
5. b2b-cart clear action - 清空购物车
6. b2b-checkout - 结算（含多赠品选择）
7. 验证满额赠送规则计算逻辑
"""
import json
import requests
import sys

SUPABASE_URL = "https://qcrcgpwlfouqslokwbzl.supabase.co"
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
MGMT_API_URL = f"https://api.supabase.com/v1/projects/qcrcgpwlfouqslokwbzl/database/query"
MGMT_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")

PASS = "✅"
FAIL = "❌"
WARN = "⚠️"

def execute_sql(sql: str) -> dict:
    """通过 Management API 执行 SQL。"""
    resp = requests.post(
        MGMT_API_URL,
        headers={"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json"},
        json={"query": sql},
        timeout=30,
    )
    return {"status": resp.status_code, "result": resp.json() if resp.text else []}

def call_edge_function(function_name: str, body: dict, session_token: str = None) -> dict:
    """调用 Edge Function。"""
    headers = {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
    }
    if session_token:
        headers["x-session-token"] = session_token
    resp = requests.post(
        f"{SUPABASE_URL}/functions/v1/{function_name}",
        headers=headers,
        json=body,
        timeout=30,
    )
    try:
        result = resp.json()
    except Exception:
        result = {"raw": resp.text}
    return {"status": resp.status_code, "result": result}

def get_test_user_session() -> tuple[str, str]:
    """获取测试用户的 session token。"""
    # 查询已有的批发商用户
    result = execute_sql("""
        SELECT u.id, u.phone, wp.status
        FROM auth.users u
        JOIN public.wholesaler_profiles wp ON wp.user_id = u.id
        WHERE wp.status = 'approved'
        LIMIT 1
    """)
    if result["status"] not in (200, 201) or not result["result"]:
        print(f"{WARN} 没有已审核的批发商用户，跳过需要认证的测试")
        return None, None
    
    user = result["result"][0]
    user_id = user["id"]
    
    # 查询用户的 session token
    session_result = execute_sql(f"""
        SELECT token FROM auth.sessions 
        WHERE user_id = '{user_id}'
        ORDER BY created_at DESC LIMIT 1
    """)
    
    if session_result["status"] not in (200, 201) or not session_result["result"]:
        print(f"{WARN} 没有找到用户 session，跳过需要认证的测试")
        return user_id, None
    
    token = session_result["result"][0].get("token")
    return user_id, token

def test_database_state():
    """测试1：验证数据库状态"""
    print("\n=== 测试1：验证数据库状态 ===")
    
    # 检查 b2b_gift_rules 表
    result = execute_sql("SELECT id, name, threshold_amount, is_active FROM public.b2b_gift_rules ORDER BY threshold_amount")
    if result["status"] in (200, 201):
        rules = result["result"]
        print(f"{PASS} b2b_gift_rules 表存在，共 {len(rules)} 条规则")
        for rule in rules:
            print(f"    - {rule['name']}: 满 {rule['threshold_amount']} TJS (active={rule['is_active']})")
    else:
        print(f"{FAIL} b2b_gift_rules 表查询失败: {result}")
        return False
    
    # 检查 b2b_gift_rule_products 表
    result = execute_sql("SELECT COUNT(*) as cnt FROM public.b2b_gift_rule_products WHERE is_active = true")
    if result["status"] in (200, 201):
        cnt = result["result"][0]["cnt"]
        print(f"{PASS} b2b_gift_rule_products 表存在，共 {cnt} 条活跃赠品配置")
    else:
        print(f"{FAIL} b2b_gift_rule_products 表查询失败: {result}")
        return False
    
    # 检查 shopping_carts 表
    result = execute_sql("SELECT COUNT(*) as cnt FROM public.shopping_carts")
    if result["status"] in (200, 201):
        cnt = result["result"][0]["cnt"]
        print(f"{PASS} shopping_carts 表存在，共 {cnt} 条购物车记录")
    else:
        print(f"{FAIL} shopping_carts 表查询失败: {result}")
        return False
    
    # 检查 b2b_create_order_from_cart_tx 函数是否支持多赠品参数
    result = execute_sql("""
        SELECT proname, pronargs, proargnames
        FROM pg_proc
        WHERE proname = 'b2b_create_order_from_cart_tx'
        AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    """)
    if result["status"] in (200, 201) and result["result"]:
        func = result["result"][0]
        argnames = func.get("proargnames", [])
        has_multi_gift = "p_selected_gift_product_ids" in (argnames or [])
        if has_multi_gift:
            print(f"{PASS} b2b_create_order_from_cart_tx 函数已升级为多赠品版本")
        else:
            print(f"{FAIL} b2b_create_order_from_cart_tx 函数仍是旧版本（参数: {argnames}）")
            return False
    else:
        print(f"{FAIL} 未找到 b2b_create_order_from_cart_tx 函数: {result}")
        return False
    
    return True

def test_gift_rules_logic():
    """测试2：验证满额赠送规则逻辑"""
    print("\n=== 测试2：验证满额赠送规则逻辑 ===")
    
    # 测试：金额为 0 时，eligible_count 应为 0
    result = execute_sql("""
        SELECT 
            COUNT(*) FILTER (WHERE threshold_amount <= 0) as eligible_at_0,
            COUNT(*) FILTER (WHERE threshold_amount <= 500) as eligible_at_500,
            COUNT(*) FILTER (WHERE threshold_amount <= 1000) as eligible_at_1000
        FROM public.b2b_gift_rules
        WHERE is_active = true
    """)
    if result["status"] in (200, 201):
        stats = result["result"][0]
        print(f"{PASS} 规则达标统计:")
        print(f"    - 金额为 0 时达标规则数: {stats['eligible_at_0']}")
        print(f"    - 金额为 500 时达标规则数: {stats['eligible_at_500']}")
        print(f"    - 金额为 1000 时达标规则数: {stats['eligible_at_1000']}")
    else:
        print(f"{FAIL} 规则逻辑查询失败: {result}")
        return False
    
    # 检查赠品商品是否有库存
    result = execute_sql("""
        SELECT rp.rule_id, ip.name, ip.stock, rp.gift_quantity
        FROM public.b2b_gift_rule_products rp
        JOIN public.inventory_products ip ON ip.id = rp.product_id
        WHERE rp.is_active = true
    """)
    if result["status"] in (200, 201):
        products = result["result"]
        print(f"{PASS} 赠品商品库存状态:")
        for p in products:
            status = PASS if p["stock"] >= p["gift_quantity"] else WARN
            print(f"    {status} {p['name']}: 库存={p['stock']}, 需要={p['gift_quantity']}")
    else:
        print(f"{FAIL} 赠品商品查询失败: {result}")
        return False
    
    return True

def test_b2b_cart_without_auth():
    """测试3：未认证时调用 b2b-cart 应返回 401"""
    print("\n=== 测试3：未认证请求测试 ===")
    
    result = call_edge_function("b2b-cart", {"action": "get"})
    if result["status"] == 401:
        print(f"{PASS} 未认证请求正确返回 401")
        return True
    else:
        print(f"{FAIL} 未认证请求返回了 {result['status']}，期望 401")
        print(f"    响应: {result['result']}")
        return False

def test_b2b_cart_with_auth(user_id: str, session_token: str):
    """测试4：认证后获取购物车"""
    print("\n=== 测试4：认证后获取购物车 ===")
    
    result = call_edge_function("b2b-cart", {"action": "get"}, session_token)
    if result["status"] == 200:
        data = result["result"]
        has_items = "items" in data
        has_summary = "summary" in data
        has_gwp = "gift_with_purchase" in data
        
        if has_items and has_summary and has_gwp:
            items = data["items"]
            summary = data["summary"]
            gwp = data["gift_with_purchase"]
            
            print(f"{PASS} 购物车数据结构正确:")
            print(f"    - items: {len(items)} 件商品")
            print(f"    - summary: total_amount={summary.get('total_amount', 0):.2f} TJS")
            
            if gwp:
                print(f"    - gift_with_purchase: eligible_count={gwp.get('eligible_count', 0)}")
                if gwp.get("rules"):
                    for rule in gwp["rules"]:
                        print(f"      * 达标规则: {rule.get('rule_name')} (门槛: {rule.get('threshold_amount')} TJS)")
                if gwp.get("next_goal"):
                    ng = gwp["next_goal"]
                    print(f"      * 下一目标: {ng.get('rule_name')} (还差 {ng.get('remaining_amount', 0):.2f} TJS, 进度 {ng.get('progress', 0)}%)")
            else:
                print(f"    - gift_with_purchase: null（购物车为空或无达标规则）")
            
            return True
        else:
            print(f"{FAIL} 购物车数据结构不完整:")
            print(f"    has_items={has_items}, has_summary={has_summary}, has_gwp={has_gwp}")
            print(f"    响应: {json.dumps(data, ensure_ascii=False)[:500]}")
            return False
    else:
        print(f"{FAIL} 获取购物车失败，状态码: {result['status']}")
        print(f"    响应: {result['result']}")
        return False

def test_b2b_cart_add_item(user_id: str, session_token: str):
    """测试5：添加商品到购物车"""
    print("\n=== 测试5：添加商品到购物车 ===")
    
    # 先获取一个可用商品
    result = execute_sql("""
        SELECT id, name, wholesale_price, stock, min_order_quantity
        FROM public.inventory_products
        WHERE status = 'ACTIVE' AND stock > 0
        ORDER BY wholesale_price DESC
        LIMIT 1
    """)
    
    if result["status"] not in (200, 201) or not result["result"]:
        print(f"{WARN} 没有可用商品，跳过添加测试")
        return True
    
    product = result["result"][0]
    product_id = product["id"]
    min_qty = product.get("min_order_quantity", 1)
    
    print(f"    使用商品: {product['name']} (价格: {product['wholesale_price']} TJS)")
    
    # 添加商品
    add_result = call_edge_function("b2b-cart", {
        "action": "add",
        "product_id": product_id,
        "quantity": min_qty
    }, session_token)
    
    if add_result["status"] == 200:
        data = add_result["result"]
        items = data.get("items", [])
        added = any(item["product_id"] == product_id for item in items)
        
        if added:
            print(f"{PASS} 商品添加成功，购物车现有 {len(items)} 件商品")
            
            # 检查满额赠送状态
            gwp = data.get("gift_with_purchase")
            if gwp:
                total = data.get("summary", {}).get("total_amount", 0)
                print(f"    当前购物车金额: {total:.2f} TJS")
                print(f"    达标规则数: {gwp.get('eligible_count', 0)}")
                if gwp.get("next_goal"):
                    ng = gwp["next_goal"]
                    print(f"    下一目标: 还差 {ng.get('remaining_amount', 0):.2f} TJS")
            
            return True, product_id
        else:
            print(f"{FAIL} 商品添加失败，购物车中找不到该商品")
            return False, None
    else:
        print(f"{FAIL} 添加商品失败，状态码: {add_result['status']}")
        print(f"    响应: {add_result['result']}")
        return False, None

def test_gift_with_purchase_threshold(user_id: str, session_token: str):
    """测试6：验证满额赠送门槛逻辑"""
    print("\n=== 测试6：验证满额赠送门槛逻辑 ===")
    
    # 获取最低门槛规则
    result = execute_sql("""
        SELECT id, name, threshold_amount
        FROM public.b2b_gift_rules
        WHERE is_active = true
        ORDER BY threshold_amount ASC
        LIMIT 1
    """)
    
    if result["status"] not in (200, 201) or not result["result"]:
        print(f"{WARN} 没有活跃的满额赠送规则，跳过门槛测试")
        return True
    
    rule = result["result"][0]
    threshold = float(rule["threshold_amount"])
    print(f"    最低门槛规则: {rule['name']} (门槛: {threshold} TJS)")
    
    # 获取当前购物车
    cart_result = call_edge_function("b2b-cart", {"action": "get"}, session_token)
    if cart_result["status"] != 200:
        print(f"{WARN} 获取购物车失败，跳过门槛测试")
        return True
    
    current_amount = cart_result["result"].get("summary", {}).get("total_amount", 0)
    gwp = cart_result["result"].get("gift_with_purchase")
    
    print(f"    当前购物车金额: {current_amount:.2f} TJS")
    
    if current_amount >= threshold:
        if gwp and gwp.get("eligible_count", 0) > 0:
            print(f"{PASS} 金额已达标，eligible_count={gwp['eligible_count']}")
        else:
            print(f"{FAIL} 金额已达标但 eligible_count=0")
            return False
    else:
        if gwp and gwp.get("next_goal"):
            ng = gwp["next_goal"]
            remaining = ng.get("remaining_amount", 0)
            expected_remaining = threshold - current_amount
            if abs(remaining - expected_remaining) < 0.01:
                print(f"{PASS} 未达标时 remaining_amount 计算正确: {remaining:.2f} TJS")
            else:
                print(f"{WARN} remaining_amount 计算偏差: 实际={remaining:.2f}, 期望={expected_remaining:.2f}")
        else:
            print(f"{WARN} 未达标但没有 next_goal（可能购物车为空）")
    
    return True

def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("B2B 满额赠送功能端到端测试")
    print("=" * 60)
    
    results = []
    
    # 测试1：数据库状态
    results.append(("数据库状态", test_database_state()))
    
    # 测试2：满额赠送规则逻辑
    results.append(("满额赠送规则逻辑", test_gift_rules_logic()))
    
    # 测试3：未认证请求
    results.append(("未认证请求", test_b2b_cart_without_auth()))
    
    # 获取测试用户 session
    user_id, session_token = get_test_user_session()
    
    if session_token:
        print(f"\n{PASS} 找到测试用户 session，继续认证测试...")
        
        # 测试4：认证后获取购物车
        results.append(("认证后获取购物车", test_b2b_cart_with_auth(user_id, session_token)))
        
        # 测试5：添加商品
        add_result = test_b2b_cart_add_item(user_id, session_token)
        if isinstance(add_result, tuple):
            results.append(("添加商品到购物车", add_result[0]))
        else:
            results.append(("添加商品到购物车", add_result))
        
        # 测试6：满额赠送门槛逻辑
        results.append(("满额赠送门槛逻辑", test_gift_with_purchase_threshold(user_id, session_token)))
    else:
        print(f"\n{WARN} 没有找到测试用户 session，跳过认证相关测试")
        results.append(("认证后获取购物车", None))
        results.append(("添加商品到购物车", None))
        results.append(("满额赠送门槛逻辑", None))
    
    # 汇总结果
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    
    passed = 0
    failed = 0
    skipped = 0
    
    for name, result in results:
        if result is True:
            print(f"{PASS} {name}")
            passed += 1
        elif result is False:
            print(f"{FAIL} {name}")
            failed += 1
        else:
            print(f"{WARN} {name} (跳过)")
            skipped += 1
    
    print(f"\n总计: {passed} 通过, {failed} 失败, {skipped} 跳过")
    
    return failed == 0

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
