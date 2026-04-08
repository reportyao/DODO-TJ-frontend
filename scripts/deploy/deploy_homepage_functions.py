#!/usr/bin/env python3
"""
部署首页场景化改造的 Edge Functions 到 Supabase

新增函数列表:
  - get-home-feed: 首页 Feed 流查询
  - get-topic-detail: 专题详情查询
  - track-behavior-event: 用户行为事件上报
  - ai-topic-generate: AI 专题生成（SSE 流式）

使用方式:
  python3 scripts/deploy/deploy_homepage_functions.py
"""
import subprocess
import json
import os
import sys

PROJECT_ID = "qcrcgpwlfouqslokwbzl"

# 首页场景化改造新增的 Edge Functions
HOMEPAGE_FUNCTIONS = [
    "get-home-feed",
    "get-topic-detail",
    "track-behavior-event",
    "ai-topic-generate",
]

# 项目根目录（相对于脚本位置）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../.."))


def read_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def deploy_function(func_name: str) -> bool:
    print(f"\n{'=' * 60}")
    print(f"部署函数: {func_name}")
    print(f"{'=' * 60}")

    func_path = os.path.join(PROJECT_ROOT, f"supabase/functions/{func_name}/index.ts")

    if not os.path.exists(func_path):
        print(f"  ❌ 文件不存在: {func_path}")
        return False

    try:
        code = read_file(func_path)

        input_data = {
            "project_id": PROJECT_ID,
            "name": func_name,
            "files": [{"name": "index.ts", "content": code}],
        }

        cmd = [
            "manus-mcp-cli",
            "tool",
            "call",
            "deploy_edge_function",
            "--server",
            "supabase",
            "--input",
            json.dumps(input_data),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode == 0:
            print(f"  ✅ {func_name} 部署成功")
            return True
        else:
            print(f"  ❌ {func_name} 部署失败")
            print(f"  stdout: {result.stdout[:500]}")
            print(f"  stderr: {result.stderr[:500]}")
            return False

    except subprocess.TimeoutExpired:
        print(f"  ❌ {func_name} 部署超时")
        return False
    except Exception as e:
        print(f"  ❌ {func_name} 部署异常: {e}")
        return False


def main():
    print("=" * 60)
    print("DODO 首页场景化改造 · Edge Functions 部署")
    print(f"项目 ID: {PROJECT_ID}")
    print(f"函数数量: {len(HOMEPAGE_FUNCTIONS)}")
    print("=" * 60)

    success = []
    failed = []

    for func_name in HOMEPAGE_FUNCTIONS:
        if deploy_function(func_name):
            success.append(func_name)
        else:
            failed.append(func_name)

    print(f"\n{'=' * 60}")
    print("部署结果汇总")
    print(f"{'=' * 60}")
    print(f"  成功: {len(success)}/{len(HOMEPAGE_FUNCTIONS)}")
    for name in success:
        print(f"    ✅ {name}")
    if failed:
        print(f"  失败: {len(failed)}/{len(HOMEPAGE_FUNCTIONS)}")
        for name in failed:
            print(f"    ❌ {name}")
        sys.exit(1)

    print("\n🎉 所有首页 Edge Functions 部署完成!")

    # 提醒环境变量
    print("\n⚠️  请确认以下环境变量已在 Supabase Dashboard 中配置:")
    print("  - OPENAI_API_KEY (ai-topic-generate 需要)")
    print("  - OPENAI_BASE_URL (可选，默认 https://api.openai.com/v1)")


if __name__ == "__main__":
    main()
