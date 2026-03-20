#!/usr/bin/env python3
"""
部署管理后台Edge Functions到Supabase
"""
import subprocess
import json
import os

PROJECT_ID = "qcrcgpwlfouqslokwbzl"

# 需要部署的管理后台函数
functions = [
    "admin-get-deposits",
    "admin-get-withdrawals",
    "admin-get-shipping",
    "admin-update-shipping"
]

def read_file(path):
    """读取文件内容"""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def deploy_function(func_name):
    """部署单个Edge Function"""
    print(f"\n{'='*60}")
    print(f"部署函数: {func_name}")
    print(f"{'='*60}")
    
    func_path = f"/home/ubuntu/project/luckymart-tj/supabase/functions/{func_name}/index.ts"
    
    if not os.path.exists(func_path):
        print(f"❌ 文件不存在: {func_path}")
        return False
    
    try:
        # 读取函数代码
        code = read_file(func_path)
        
        # 构建部署参数
        input_data = {
            "project_id": PROJECT_ID,
            "name": func_name,
            "files": [
                {
                    "name": "index.ts",
                    "content": code
                }
            ]
        }
        
        input_json = json.dumps(input_data)
        
        # 调用MCP部署
        result = subprocess.run(
            [
                "manus-mcp-cli", "tool", "call", "deploy_edge_function",
                "--server", "supabase",
                "--input", input_json
            ],
            capture_output=True,
            text=True,
            timeout=120
        )
        
        if result.returncode == 0:
            print(f"✅ {func_name} 部署成功!")
            return True
        else:
            print(f"❌ {func_name} 部署失败!")
            print(f"错误: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ {func_name} 部署异常: {e}")
        return False

def main():
    print("\n" + "="*60)
    print("开始部署管理后台Edge Functions到Supabase")
    print(f"项目ID: {PROJECT_ID}")
    print(f"函数数量: {len(functions)}")
    print("="*60)
    
    success_count = 0
    failed_count = 0
    
    for func_name in functions:
        if deploy_function(func_name):
            success_count += 1
        else:
            failed_count += 1
    
    print("\n" + "="*60)
    print("部署完成!")
    print(f"成功: {success_count}/{len(functions)}")
    print(f"失败: {failed_count}/{len(functions)}")
    print("="*60)
    
    return failed_count == 0

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
