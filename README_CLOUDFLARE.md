# PixPro R2 部署指南

这个分支把旧版 PixPro 从 PHP + MySQL 改造成 Cloudflare Workers + R2，无需 VPS。

## 架构

- 前端：Cloudflare Workers Static Assets
- API：Cloudflare Worker
- 图片存储：Cloudflare R2
- 鉴权：`ADMIN_TOKEN` Worker Secret
- 数据库：无

## 功能

- 批量上传图片
- 拖拽上传
- 粘贴上传
- 图库浏览
- 复制图片直链
- 复制 Markdown
- 删除图片
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

## 5. 部署

```bash
npm run deploy
```

部署完成后会得到一个 `*.workers.dev` 地址。

## 6. 绑定自定义域名

推荐把原来的图床域名重新使用，例如：

`bed.lianli.us.kg`

在 Cloudflare Workers 项目设置中添加 Custom Domain 即可。

## 7. 使用

打开站点后输入 `ADMIN_TOKEN`，浏览器会把它保存在 localStorage 中。

上传后的图片地址格式类似：

```text
https://bed.example.com/i/2026/09/05/xxxxxxxxxxxxxxxx.webp
```

## API

### 上传

```http
POST /api/upload
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: multipart/form-data
```

字段：`files`，可重复。

### 图片列表

```http
GET /api/images
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

R2 的本地开发环境与线上 bucket 行为不同，建议先完成 Cloudflare 登录后再运行：

```bash
npm run dev
```

## 安全建议

1. 不要把 `ADMIN_TOKEN` 写入源码。
2. 如果怀疑泄露，重新运行 `npx wrangler secret put ADMIN_TOKEN` 即可轮换。
3. 当前 API 默认只有持有管理员口令的人可以上传、浏览列表和删除。
4. 图片直链 `/i/*` 是公开读取的，符合个人图床用途。

## 与旧 PixPro 的区别

这个版本不再需要：

- PHP
- MySQL
- Apache / Nginx
- Imagick / GD
- Serv00
- VPS

旧的 PHP 文件仍暂时保留在分支中，仅用于历史对照；Cloudflare 部署不会使用这些文件。
