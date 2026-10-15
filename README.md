# 电商图片提取下载器

一款 Chrome 浏览器扩展插件，帮助电商从业者在浏览商品详情页时，一键抓取页面内所有商品图片，并在独立页面中集中预览、勾选，批量下载为 **PNG** 格式。

- 支持平台：淘宝 / 天猫、京东、拼多多商家版
- 主题色：黄色渐变
- 架构：Chrome Manifest V3

---

## 功能特性

- 右下角悬浮「获取图片」按钮，点击即抓取
- 兼容图片懒加载（`data-src`、`srcset`、背景图、`<script>` JSON 等）
- 去重过滤，剔除 logo / icon / 表情 / 广告等非商品图，优先高清原图
- 新标签页集中展示：响应式网格、全选 / 清空 / 勾选、放大预览（lightbox）
- 批量下载并统一转为 PNG（经 background Service Worker 跨域抓取与 canvas 重编码）
- 下载进度提示、成功 / 失败数量反馈

---

## 安装方法

1. 打开 Chrome，地址栏输入 `chrome://extensions/` 并回车。
2. 打开右上角「开发者模式」开关。
3. 点击左上角「加载已解压的扩展程序」。
4. 选择本项目根目录（包含 `manifest.json` 的文件夹）。
5. 安装完成后，进入淘宝 / 京东 / 拼多多商家版的商品详情页，右下角会出现「获取图片」按钮。

> 图标已在 `icons/` 目录提供（16 / 48 / 128）。如需重新生成，运行：
> `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-icons.ps1`

---

## 使用步骤

1. 打开任意受支持平台的商品详情页。
2. 点击右下角「获取图片」按钮。
3. 等待抓取完成，会自动打开结果页。
4. 在结果页勾选需要的图片（默认全选）。
5. 点击「下载所选图片」，浏览器将逐张下载 PNG 文件。

---

## 目录结构

```
imgdownload/
├── manifest.json        # MV3 插件清单
├── background.js        # Service Worker：跨域抓图 + PNG 转换 + 下载 + 打开结果页
├── content.js           # 注入按钮 + 抓取图片（Shadow DOM 隔离样式）
├── result.html          # 结果页（展示 / 勾选 / 预览）
├── result.css           # 结果页样式（黄色渐变主题）
├── result.js            # 结果页逻辑
├── popup.html           # 工具栏弹窗
├── popup.css            # 弹窗样式
├── icons/               # 插件图标
└── scripts/gen-icons.ps1 # 图标生成脚本
```

---

## 各平台抓取策略

| 平台 | 主图选择器 | 详情图处理 |
| --- | --- | --- |
| 淘宝 / 天猫 | `#J_UlThumb img`、`.tb-thumb img`、`.tb-gallery img` 等 | 详情图常懒加载，读取 `data-src` / `data-ks-lazyload`，并扫描 `<script>` 中 JSON 的 `alicdn` 图片地址 |
| 京东 | `#spec-list img`、`.spec-items img`、`#spec-img` 等 | 图片 URL 含 `s450x450_` 尺寸前缀，抓取时剔除前缀还原高清原图 |
| 拼多多商家版 | `.gallery img`、`[class*=gallery] img` 等 | 商家后台结构多变，依赖通用图片扫描 + 背景图 + script JSON 兜底 |

高清化处理（`upgradeUrl`）：自动去除 `_400x400q90`、`.jpg_400x400.jpg`、`s450x450_` 等尺寸标记，优先取原图。

---

## 技术说明与注意点

- **跨域**：图片 CDN 域名（`alicdn.com`、`360buyimg.com` 等）与页面不同源，插件通过 `host_permissions: ["<all_urls>"]` + Service Worker 的 `fetch` 绕过页面侧 CORS 限制。
- **PNG 转换**：Service Worker 内用 `createImageBitmap` + `OffscreenCanvas.convertToBlob({ type: 'image/png' })` 统一重编码，再以 data URL 交给 `chrome.downloads` 下载。
- **防盗链**：部分 CDN 对带 Referer 的请求做拦截，`background.js` 会降级为 `referrerPolicy: 'no-referrer'` 重试一次。
- **风控**：插件仅在用户手动点击时单次抓取，不做自动高频抓取，以降低触发平台风控的风险。
