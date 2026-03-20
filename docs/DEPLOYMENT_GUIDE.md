# LuckyMart-TJ 测试环境部署指南

**日期**: 2026年1月11日  
**目标服务器**: test.tezbarakat.com (47.82.78.182)

## 前端部署步骤

### 1. 下载构建好的前端文件

前端文件已上传到CDN，可以通过以下URL下载：

```
https://files.manuscdn.com/user_upload_by_module/session_file/310519663267033178/uTybacUpgECaqijB.gz
```

文件大小：436 KB（已压缩）

### 2. 在测试服务器上执行部署

登录到测试服务器后，执行以下命令：

```bash
# 下载前端文件
cd /tmp
wget -O frontend-test.tar.gz "https://files.manuscdn.com/user_upload_by_module/session_file/310519663267033178/uTybacUpgECaqijB.gz"

# 创建部署目录
mkdir -p /var/www/test.tezbarakat.com

# 解压到部署目录
cd /var/www/test.tezbarakat.com
rm -rf *
tar -xzf /tmp/frontend-test.tar.gz --strip-components=1

# 设置权限
chown -R www-data:www-data /var/www/test.tezbarakat.com
chmod -R 755 /var/www/test.tezbarakat.com

# 验证文件
ls -la /var/www/test.tezbarakat.com
```

### 3. 配置Nginx（如果需要）

如果Nginx配置不存在，创建配置文件：

```bash
cat > /etc/nginx/sites-available/test.tezbarakat.com << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name test.tezbarakat.com;
    
    # 重定向到HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name test.tezbarakat.com;
    
    # SSL证书配置（根据实际情况调整）
    ssl_certificate /etc/letsencrypt/live/test.tezbarakat.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test.tezbarakat.com/privkey.pem;
    
    root /var/www/test.tezbarakat.com;
    index index.html;
    
    # 禁用缓存（测试环境）
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    add_header Pragma "no-cache";
    add_header Expires "0";
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 静态资源缓存（可选）
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# 启用站点
ln -sf /etc/nginx/sites-available/test.tezbarakat.com /etc/nginx/sites-enabled/

# 测试配置
nginx -t

# 重启Nginx
systemctl reload nginx
```

### 4. 验证部署

访问以下URL验证部署是否成功：

- HTTP: http://test.tezbarakat.com（应自动重定向到HTTPS）
- HTTPS: https://test.tezbarakat.com

## 环境配置

前端已配置为连接测试环境Supabase：

| 配置项 | 值 |
|--------|-----|
| Supabase URL | https://qcrcgpwlfouqslokwbzl.supabase.co |
| Supabase Anon Key | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... |

## Edge Functions状态

所有70个Edge Functions已部署到测试环境Supabase：

- Dashboard: https://supabase.com/dashboard/project/qcrcgpwlfouqslokwbzl/functions

## 数据库Schema

所有必要的数据库字段已添加，详见：

- 迁移文档: `docs/database-migration-20260111.md`
- 修复报告: `docs/DATABASE_SCHEMA_FIX_REPORT.md`

## 故障排查

### 前端无法加载

1. 检查Nginx配置是否正确
2. 检查文件权限：`ls -la /var/www/test.tezbarakat.com`
3. 检查Nginx错误日志：`tail -f /var/log/nginx/error.log`

### API请求失败

1. 检查浏览器控制台的网络请求
2. 验证Supabase配置是否正确
3. 检查Edge Functions是否正常运行

### SSL证书问题

如果SSL证书过期或不存在：

```bash
# 使用Let's Encrypt获取证书
sudo certbot --nginx -d test.tezbarakat.com
```

## 快速部署脚本

将以下内容保存为 `deploy.sh` 并执行：

```bash
#!/bin/bash
set -e

echo "开始部署 LuckyMart-TJ 测试环境..."

# 下载文件
cd /tmp
wget -q -O frontend-test.tar.gz "https://files.manuscdn.com/user_upload_by_module/session_file/310519663267033178/uTybacUpgECaqijB.gz"

# 部署
mkdir -p /var/www/test.tezbarakat.com
cd /var/www/test.tezbarakat.com
rm -rf *
tar -xzf /tmp/frontend-test.tar.gz --strip-components=1
chown -R www-data:www-data /var/www/test.tezbarakat.com
chmod -R 755 /var/www/test.tezbarakat.com

# 重启Nginx
systemctl reload nginx

echo "部署完成！"
echo "访问: https://test.tezbarakat.com"
```

执行：

```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

## 联系方式

如有问题，请联系开发团队。
