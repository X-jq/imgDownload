// content.js — 电商详情页注入脚本
// 职责：
//   1. 在页面右下角注入「获取图片」悬浮按钮（使用 Shadow DOM 隔离页面样式）
//   2. 抓取商品主图 + 详情图（兼容懒加载、srcset、背景图、<script> JSON）
//   3. 将结果写入 chrome.storage.local，并通知后台打开结果页

(() => {
  'use strict';

  if (window.__ecomImgExtractorLoaded) return;
  window.__ecomImgExtractorLoaded = true;

  const PLATFORM = detectPlatform();
  if (!PLATFORM) return; // 非支持平台（manifest 已限制，双保险）

  // ---------- UI（Shadow DOM） ----------
  const host = document.createElement('div');
  host.setAttribute('data-ecom-ext', '1');
  host.style.cssText =
    'position:fixed;right:20px;bottom:20px;z-index:2147483647;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .grab {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 13px 22px;
      border: none; border-radius: 999px;
      background: linear-gradient(135deg, #FFE53B 0%, #FFC107 45%, #FF9800 100%);
      color: #5b3a00;
      font-size: 15px; font-weight: 700; letter-spacing: .5px; line-height: 1;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(255,152,0,.45), 0 2px 6px rgba(0,0,0,.12);
      transition: transform .18s ease, box-shadow .18s ease;
      user-select: none;
    }
    .grab:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(255,152,0,.55); }
    .grab:active { transform: translateY(0); }
    .grab__icon { display: block; flex: 0 0 auto; }
    .grab.is-loading { pointer-events: none; opacity: .85; }
    .grab.is-loading .grab__icon { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .toast {
      position: fixed; right: 20px; bottom: 88px;
      max-width: 280px; padding: 10px 16px;
      border-radius: 12px;
      background: rgba(33,37,41,.92);
      color: #fff; font-size: 13px; line-height: 1.5;
      opacity: 0; transform: translateY(8px);
      transition: opacity .25s ease, transform .25s ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
  `;
  shadow.appendChild(style);

  const btn = document.createElement('button');
  btn.className = 'grab';
  btn.type = 'button';
  btn.innerHTML =
    '<svg class="grab__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M12 3v11m0 0l-4.6-4.6M12 14l4.6-4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<path d="M4.5 19.5h15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '</svg>' +
    '<span class="grab__text">获取图片</span>';
  btn.addEventListener('click', onGrab);
  shadow.appendChild(btn);

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  shadow.appendChild(toast);

  const append = () => {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  };
  if (document.body) append();
  else document.addEventListener('DOMContentLoaded', append);

  // ---------- 交互 ----------
  async function onGrab() {
    btn.classList.add('is-loading');
    btn.querySelector('.grab__text').textContent = '获取中…';
    showToast('正在获取图片…');

    try {
      const images = collectImages();
      if (!images.length) {
        showToast('未找到可下载的商品图片');
        return;
      }

      const meta = {
        title: getTitle(),
        url: location.href,
        platform: PLATFORM
      };
      const id = 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await chrome.storage.local.set({ [id]: { images, meta, createdAt: Date.now() } });
      await cleanupOldBatches(id);

      showToast(`已获取 ${images.length} 张图片，正在打开…`);
      await chrome.runtime.sendMessage({ type: 'openResult', id });
    } catch (e) {
      showToast('获取失败：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      btn.classList.remove('is-loading');
      btn.querySelector('.grab__text').textContent = '获取图片';
    }
  }

  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // 清理 30 分钟前的历史批次，避免 storage 无限增长
  async function cleanupOldBatches(currentId) {
    try {
      const all = await chrome.storage.local.get(null);
      const cutoff = Date.now() - 30 * 60 * 1000;
      const stale = Object.keys(all)
        .filter((k) => k.startsWith('batch_') && k !== currentId && (all[k] && all[k].createdAt < cutoff));
      if (stale.length) await chrome.storage.local.remove(stale);
    } catch (_) { /* 忽略清理失败 */ }
  }

  // ---------- 抓取 ----------
  function collectImages() {
    const map = new Map(); // key: 去 hash 后的 URL -> 记录

    const add = (url, source, width = 0, height = 0) => {
      const u = normalizeUrl(url);
      if (!u || isNoise(u)) return;
      const upgraded = upgradeUrl(u);
      const final = upgraded || u;
      const key = stripHash(final);
      if (map.has(key)) {
        const cur = map.get(key);
        if (sourceRank(source) < sourceRank(cur.source)) cur.source = source;
        if (width > cur.width) { cur.width = width; cur.height = height; }
        return;
      }
      map.set(key, { url: final, width, height, source });
    };

    // 1) 主图（平台优先选择器，保证排序靠前）
    mainSelectors().forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        candidateUrls(el).forEach((u) => add(u, 'main', el.naturalWidth || 0, el.naturalHeight || 0));
      });
    });

    // 2) 全页面 <img>
    document.querySelectorAll('img').forEach((img) => {
      candidateUrls(img).forEach((u) => add(u, 'generic', img.naturalWidth || 0, img.naturalHeight || 0));
    });

    // 3) 背景图（内联 + 计算样式）
    document.querySelectorAll('div,li,a,span,figure,section,article,td').forEach((el) => {
      backgroundUrls(el).forEach((u) => add(u, 'generic'));
    });

    // 4) <script> JSON 中的图片地址（详情图常动态注入）
    scriptImageUrls().forEach((u) => add(u, 'script'));

    // 5) 排序与过滤
    const list = [...map.values()].filter((it) => {
      // 已确定尺寸且过小的图（icon/占位）剔除；尺寸未知则保留
      if (it.width > 0 && it.height > 0 && it.width < 60 && it.height < 60) return false;
      return true;
    });
    const main = list.filter((it) => it.source === 'main');
    const rest = list.filter((it) => it.source !== 'main');
    return [...main, ...rest].map((it) => ({ url: it.url, width: it.width, height: it.height }));
  }

  function detectPlatform() {
    const h = location.hostname;
    if (/taobao\.com$/.test(h) || /tmall\.com$/.test(h)) return 'taobao';
    if (/jd\.com$/.test(h)) return 'jd';
    if (/pinduoduo\.com$/.test(h) || /yangkeduo\.com$/.test(h)) return 'pdd';
    return null;
  }

  function mainSelectors() {
    switch (PLATFORM) {
      case 'taobao':
        return ['#J_UlThumb img', '.tb-thumb img', '.tb-gallery img', '.thumbnail img', '.tb-pic img', '#J_ThumbView img'];
      case 'jd':
        return ['#spec-list img', '.spec-items img', '#spec-img', '.lh img', '.jqzoom img', '.preview-wrap img'];
      case 'pdd':
        return ['.gallery img', '.goods-gallery img', '.sku-img img', '.img-list img', '[class*=gallery] img', '[class*=swiper] img'];
      default:
        return [];
    }
  }

  function sourceRank(s) {
    return s === 'main' ? 0 : (s === 'generic' ? 1 : 2);
  }

  function candidateUrls(el) {
    const urls = [];
    const lazyAttrs = [
      'data-src', 'data-lazy-src', 'data-original', 'data-ks-lazyload',
      'data-lazyload-src', 'data-img', 'data-url', 'data-image',
      'data-large', 'data-big', 'data-pic'
    ];
    for (const a of lazyAttrs) {
      const v = el.getAttribute(a);
      if (v) urls.push(...extractValue(v));
    }
    if (el.srcset) urls.push(...urlsFromSrcset(el.srcset));
    const ds = el.getAttribute('data-srcset');
    if (ds) urls.push(...urlsFromSrcset(ds));
    if (el.currentSrc) urls.push(el.currentSrc);
    if (el.src) urls.push(el.src);
    return urls;
  }

  function extractValue(v) {
    if (!v) return [];
    const s = String(v).trim();
    // 形如 srcset 的多候选项
    if (/,\s*\S+\s+\d+w/i.test(s)) return urlsFromSrcset(s);
    return [s];
  }

  function urlsFromSrcset(srcset) {
    const out = [];
    let best = null;
    let bestW = 0;
    for (let part of srcset.split(',')) {
      part = part.trim();
      const m = part.match(/^(\S+)\s+(\d+)w$/);
      if (m) {
        const w = parseInt(m[2], 10);
        if (w > bestW) { bestW = w; best = m[1]; }
      } else if (part && !best) {
        best = part;
      }
    }
    if (best) out.push(best);
    return out;
  }

  function backgroundUrls(el) {
    const urls = [];
    const sources = [];
    try { sources.push(el.style.backgroundImage); } catch (_) {}
    try { sources.push(getComputedStyle(el).backgroundImage); } catch (_) {}
    for (const bg of sources) {
      if (!bg || bg === 'none') continue;
      const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
      let m;
      while ((m = re.exec(bg))) {
        if (m[2] && m[2] !== 'none') urls.push(m[2]);
      }
    }
    return urls;
  }

  function scriptImageUrls() {
    const out = [];
    const re = /https?:\\?\/\\?\/[^"'\s\\<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\]*)?/gi;
    for (const s of document.scripts) {
      const text = s.textContent || '';
      if (!text) continue;
      let m;
      while ((m = re.exec(text))) {
        out.push(m[0].replace(/\\\//g, '/'));
      }
    }
    return out;
  }

  function normalizeUrl(raw) {
    if (!raw) return null;
    let u = String(raw).trim().replace(/&amp;/g, '&');
    if (u.startsWith('//')) u = location.protocol + u;
    else if (u.startsWith('/')) u = location.origin + u;
    if (!/^https?:\/\//i.test(u)) return null;
    return u;
  }

  const NOISE_RE = /(?:avatar|logo|icon|sprite|emoji|qrcode|qr_code|sicon|favicon|placeholder|loading|spacer|blank|transparent|countdown|\.svg|\.gif|\.ico)/i;
  function isNoise(u) {
    return NOISE_RE.test(u);
  }

  function upgradeUrl(u) {
    let out = u;
    // xxx_400x400q90.jpg -> xxx.jpg
    out = out.replace(/_\d{1,4}x\d{1,4}(?:q\d{1,3})?(\.(?:jpg|jpeg|png|webp))$/i, '$1');
    // xxx.jpg_400x400q90.jpg -> xxx.jpg
    out = out.replace(/\.(jpg|jpeg|png|webp)_\d{1,4}x\d{1,4}(?:q\d{1,3})?\.(jpg|jpeg|png|webp)$/i, '.$1');
    // 京东 n1/s450x450_xxx -> n1/xxx
    out = out.replace(/(\/)s\d{1,4}x\d{1,4}_/i, '$1');
    return out;
  }

  function stripHash(u) {
    try {
      const url = new URL(u);
      url.hash = '';
      return url.toString();
    } catch (_) {
      return u;
    }
  }

  function getTitle() {
    const selectors = [
      '.tb-main-title', '.tb-detail-hd h1', 'h1',
      '.sku-name', '.itemInfo-wrap .sku-name',
      '.goods-name', '.goods-detail-title'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim().slice(0, 80);
    }
    return (document.title || '商品图片').replace(/[-_|—].*$/, '').trim().slice(0, 80) || '商品图片';
  }
})();
