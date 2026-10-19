// background.js — Manifest V3 Service Worker
// 职责：
//   1. 接收 content.js 的「打开结果页」请求并创建/复用标签页
//   2. 跨域抓取图片 → 统一重编码为 PNG → 触发浏览器下载
//   通过 host_permissions 获得跨域访问能力，规避页面侧 CORS 限制。

'use strict';

const PNG_MIME = 'image/png';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'openResult') {
    openResult(msg.id)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // 异步响应
  }

  if (msg && msg.type === 'downloadImage') {
    downloadImageAsPng(msg.url, msg.filename)
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // 异步响应
  }

  if (msg && msg.type === 'fetchImageAsPng') {
    // 仅抓图并转 PNG，返回 data URL（供结果页打包 ZIP 使用，不触发下载）
    fetchAsPngDataUrl(msg.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true; // 异步响应
  }

  return false;
});

// 打开（或复用）结果页标签
async function openResult(id) {
  const base = chrome.runtime.getURL('result.html');
  const url = id ? `${base}?id=${encodeURIComponent(id)}` : base;

  const tabs = await chrome.tabs.query({ url: base + '*' });
  if (tabs && tabs.length) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// 单张图片：下载并转 PNG
async function downloadImageAsPng(url, filename) {
  const dataUrl = await fetchAsPngDataUrl(url);
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: ensurePngFilename(filename),
    conflictAction: 'uniquify',
    saveAs: false
  });
  return { downloadId };
}

// 抓图 + 重编码为 PNG，返回 data URL（downloads API 对 data URL 支持最稳）
async function fetchAsPngDataUrl(url) {
  let resp = null;
  try {
    resp = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  } catch (_first) {
    // 部分 CDN 对带 Referer 的请求做防盗链，降级为 no-referrer 重试一次
    resp = await fetch(url, { credentials: 'omit', cache: 'force-cache', referrerPolicy: 'no-referrer' });
  }

  if (!resp || !resp.ok) {
    throw new Error(`图片请求失败：HTTP ${resp ? resp.status : 'ERR'}`);
  }

  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: PNG_MIME });
    return await blobToDataUrl(pngBlob);
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片数据失败'));
    reader.readAsDataURL(blob);
  });
}

function ensurePngFilename(name) {
  const n = String(name || 'image.png').trim();
  return /\.png$/i.test(n) ? n : `${n}.png`;
}
