# PixPro R2 部署指南

这个分支把旧版 PixPro 从 PHP + MySQL 改造成 Cloudflare Workers + R2，无需 VPS，同时继续使用原版 PixPro 的前台、登录页和瀑布流后台视觉。

## 架构

- 前端 UI：原 PixPro `static/` 静态资源
- 静态托管：Cloudflare Workers Static Assets
- API：Cloudflare Worker
- 图片存储：Cloudflare R2
- 鉴权：`ADMIN_TOKEN` Worker Secret
- 数据库：无

## 已保留 / 重做的功能

- 原 PixPro 毛玻璃前台 UI
- 原 PixPro 背景、图标、上传框和链接 Tabs
- 原 PixPro 风格后台登录页
- 原 PixPro 瀑布流管理后台 + Fancybox 预览
- 批量上传、拖拽上传、剪贴板粘贴
- URL 图片抓取并保存到 R2
- 浏览器端 JPEG / PNG -> WebP 压缩（质量滑块 60-100）
- 原图 / 压缩后尺寸和体积展示
- 图片直链 / Markdown / HTML 一键复制
- 后台分页、删除图片
- 私有管理口令

## 1. 创建 R2 Bucket

进入 Cloudflare Dashboard -> R2 -> Create bucket，新建：

`pixpro-images`

如果使用其他 bucket 名称，请同步修改 `wrangler.jsonc` 中的 `bucket_name`。

## 2. 本地安装依赖

```bash
npm install
```

## 3. 登录 Cloudflare

```bash
npx wrangler login
```

## 4. 设置管理员口令

```bash
npx wrangler secret put ADMIN_TOKEN
```

输入一个足够长的随机字符串。不要把口令提交到 GitHub。

## 5. 部署 / 更新

```bash
npm run deploy
```

如果你之前已经部署过最初的 R2 版，只需要拉取最新 `cloudflare-r2` 分支后再次执行 `npm run deploy`，R2 Bucket 和 `ADMIN_TOKEN` Secret 不需要重新创建。

## 6. 绑定自定义域名

推荐继续使用原来的图床域名，例如：

`bed.lianli.us.kg`

在 Cloudflare Workers 项目设置中添加 Custom Domain 即可。

## 7. 使用

### 前台

打开 `/` 即为原 PixPro 风格上传页。

第一次上传时会提示输入 `ADMIN_TOKEN`，口令只保存在当前浏览器的 localStorage。之后上传不会重复询问。

### 后台

访问：

`/admin/`

使用 `ADMIN_TOKEN` 登录。登录后进入原 PixPro 风格瀑布流管理后台。

上传后的图片地址格式类似：

```text
https://bed.example.com/i/2026/09/05/xxxxxxxxxxxxxxxx.webp
```

## API

### 上传本地图片

```http
POST /api/upload
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: multipart/form-data
```

字段：`files`，可重复。

### URL 图片上传

```http
POST /api/upload-url
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{"url":"https://example.com/image.jpg"}
```

### 图片列表

```http
GET /api/images?limit=1000
Authorization: Bearer <ADMIN_TOKEN>
```

### 删除

```http
DELETE /api/images
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{"key":"images/2026/09/05/xxx.webp"}
```

## 本地调试

```bash
npm run dev
```

## 安全建议

1. 不要把 `ADMIN_TOKEN` 写入源码。
2. 如果怀疑泄露，重新运行 `npx wrangler secret put ADMIN_TOKEN` 即可轮换。
3. 只有持有管理员口令的人可以上传、浏览完整图片列表和删除。
4. 图片直链 `/i/*` 是公开读取的，符合个人图床用途。
5. URL 上传接口会拒绝 localhost 和常见私网地址。

## 与旧 PixPro 的区别

运行时不再需要：

- PHP
- MySQL
- Apache / Nginx
- Imagick / GD
- Serv00
- VPS

旧 PHP 文件仍保留在分支中用于历史对照；Cloudflare 实际只上传 `static/` 目录作为前端资产，并运行 `src/index.js` 作为 API。
