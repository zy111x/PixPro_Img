# PixPro R2 部署指南

这个分支把 PixPro 改造成 Cloudflare Workers + R2 无服务器图床，无需 VPS。

## 当前默认配置

- 站点地址：`https://picture.291055.xyz`
- 管理后台：`https://picture.291055.xyz/admin/`
- 图片公开地址前缀：`https://picture.291055.xyz/i/`
- 背景图片：`https://pic.291055.xyz/static/images/bg.webp`
- 项目仓库：`git@github.com:zy111x/PixPro_Img.git`
- GitHub 页面：`https://github.com/zy111x/PixPro_Img`

当前 UI 以 `JLinMr/PixPro` 的新版界面作为视觉基准：

- UI 基准 commit：`aa8901c76ac86576d01f3c43937cb72e41082541`
- 上游 commit 日期：2026-06-27

上游仅作为 UI 设计/样式基准；当前实际维护项目为 `zy111x/PixPro_Img`。

## 架构

- 前台 / 后台 UI：新版 PixPro HTML 结构与样式
- UI CSS：锁定到上述 UI 基准 commit，避免上游 `main` 后续变化导致页面突然失效
- 自有交互层：`static/js/r2-script.js`、`static/js/r2-admin.js`
- 静态托管：Cloudflare Workers Static Assets
- API：Cloudflare Worker
- 图片存储：Cloudflare R2
- 鉴权：`ADMIN_TOKEN` Worker Secret
- 数据库：无

## 已保留 / 适配的功能

- PixPro 毛玻璃前台 UI
- 多图缩略图
- 左右切换 / 滚轮切换 / 键盘方向键切换
- 拖拽上传、粘贴上传、批量上传
- URL 图片抓取并保存到 R2
- JPEG / PNG 浏览器端 WebP 压缩
- 图片清晰度滑块
- 原图 / 压缩后尺寸、体积、压缩率、节省空间展示
- 图片直链 / Markdown / HTML 一键复制
- Ctrl / Cmd + 点击批量复制
- PixPro 风格后台
- 网格图库 + Fancybox
- 后台分页
- 单图复制、删除
- 多选、批量复制、批量删除
- `ADMIN_TOKEN` 登录

## 与原版 PixPro 的区别

只保留/适配界面和核心交互，数据层改成 Cloudflare 原生架构，不再使用：

- PHP
- SQLite / MySQL
- Apache / Nginx
- Imagick / GD
- Serv00
- VPS

图片存储统一使用 Cloudflare R2。

## 1. 克隆项目

```bash
git clone git@github.com:zy111x/PixPro_Img.git
cd PixPro_Img
git checkout cloudflare-r2
```

## 2. 创建 R2 Bucket

Cloudflare Dashboard -> R2 -> Create bucket：

```text
pixpro-images
```

如果使用其他名称，请修改 `wrangler.jsonc` 的 `bucket_name`。

## 3. 安装

```bash
npm install
```

## 4. 登录 Cloudflare

```bash
npx wrangler login
```

## 5. 设置管理口令

```bash
npx wrangler secret put ADMIN_TOKEN
```

建议使用足够长的随机字符串，不要提交到 GitHub。

## 6. 部署 / 更新

如果你已经部署过此前版本：

```bash
git checkout cloudflare-r2
git pull
npm install
npm run deploy
```

已有 R2 Bucket 和 `ADMIN_TOKEN` 不需要重建。

`wrangler.jsonc` 已配置 Custom Domain：

```text
picture.291055.xyz
```

部署时会使用这个域名作为 Worker 的自定义域名。

## 7. 使用

前台：

```text
https://picture.291055.xyz
```

第一次上传会要求输入 `ADMIN_TOKEN`，仅保存在当前浏览器 localStorage。

后台：

```text
https://picture.291055.xyz/admin/
```

使用同一个 `ADMIN_TOKEN` 登录。

图片直链固定为：

```text
https://picture.291055.xyz/i/2026/09/05/xxxxxxxxxxxxxxxx.webp
```

即使通过 `*.workers.dev` 地址打开管理页面，新生成/复制的图片链接仍会使用 `https://picture.291055.xyz`。

## 默认站点变量

`wrangler.jsonc` 中：

```json
{
  "vars": {
    "MAX_UPLOAD_MB": "10",
    "PUBLIC_BASE_URL": "https://picture.291055.xyz",
    "BACKGROUND_URL": "https://pic.291055.xyz/static/images/bg.webp"
  }
}
```

如果以后再次换域名，优先修改 `PUBLIC_BASE_URL` 和 `routes[].pattern`。

如果以后更换背景，修改 `BACKGROUND_URL` 即可。

## API

### 上传

```http
POST https://picture.291055.xyz/api/upload
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: multipart/form-data
```

字段：`files`，可重复。

### URL 图片上传

```http
POST https://picture.291055.xyz/api/upload-url
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{"url":"https://example.com/image.jpg"}
```

### 图片列表

```http
GET https://picture.291055.xyz/api/images?limit=1000
Authorization: Bearer <ADMIN_TOKEN>
```

### 删除

```http
DELETE https://picture.291055.xyz/api/images
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
2. 怀疑泄露时重新执行 `npx wrangler secret put ADMIN_TOKEN` 轮换。
3. 上传、图库列表和删除操作都要求管理口令。
4. `/i/*` 图片直链公开可读。
5. URL 上传拒绝 localhost 和常见私网地址。

## UI 更新策略

当前样式锁定在 `aa8901c76ac86576d01f3c43937cb72e41082541`，不会自动追踪上游 `main`。这样部署更稳定。

以后如果想升级 PixPro UI，应先查看上游变更，再更新 HTML / R2 适配层以及 CSS commit，而不是直接使用 `@main`。
