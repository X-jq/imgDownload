// result.js — 结果页逻辑
// 职责：读取批次图片 → 渲染网格 → 勾选 → 批量下载（经 background 转 PNG）

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const empty = $('empty');
  const selectAll = $('selectAll');
  const selectedCount = $('selectedCount');
  const countChip = $('countChip');
  const downloadBtn = $('downloadBtn');
  const zipBtn = $('zipBtn');
  const clearBtn = $('clearBtn');
  const sourceInfo = $('sourceInfo');
  const toastEl = $('toast');
  const progress = $('progress');
  const progressBar = $('progressBar');
  const progressText = $('progressText');
  const lightbox = $('lightbox');
  const lightboxImg = $('lightboxImg');
  const lightboxClose = $('lightboxClose');

  const params = new URLSearchParams(location.search);
  const batchId = params.get('id');

  let images = [];
  let meta = {};
  const selection = new Set();

  const PLATFORM_NAMES = { taobao: '淘宝 / 天猫', jd: '京东', pdd: '拼多多商家版' };

  // ---------- 加载 ----------
  async function load() {
    let batch = null;
    if (batchId) {
      const data = await chrome.storage.local.get(batchId);
      batch = data[batchId];
    }
    if (!batch || !Array.isArray(batch.images) || !batch.images.length) {
      renderEmpty();
      return;
    }
    images = batch.images;
    meta = batch.meta || {};
    sourceInfo.textContent = `${PLATFORM_NAMES[meta.platform] || '电商'} · ${meta.title || ''}`.trim();
    renderGrid();
    bindEvents();
  }

  function renderEmpty() {
    grid.hidden = true;
    empty.hidden = false;
    document.querySelector('.toolbar').hidden = true;
  }

  // ---------- 渲染 ----------
  function renderGrid() {
    grid.innerHTML = '';
    selection.clear();
    images.forEach((img, i) => {
      selection.add(i);

      const card = document.createElement('div');
      card.className = 'card selected';
      card.dataset.index = String(i);

      const im = document.createElement('img');
      im.className = 'card__img';
      im.loading = 'lazy';
      im.src = img.url;
      im.alt = `图片 ${i + 1}`;
      im.addEventListener('error', () => { im.style.opacity = '.4'; });

      const check = document.createElement('div');
      check.className = 'card__check';

      const zoom = document.createElement('button');
      zoom.className = 'card__zoom';
      zoom.type = 'button';
      zoom.title = '放大预览';
      zoom.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/>' +
        '<path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>';
      zoom.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(img.url); });

      card.appendChild(im);
      card.appendChild(check);
      card.appendChild(zoom);

      card.addEventListener('click', () => toggle(i, card));
      grid.appendChild(card);
    });
    updateCounts();
  }

  function toggle(i, card) {
    if (selection.has(i)) {
      selection.delete(i);
      card.classList.remove('selected');
    } else {
      selection.add(i);
      card.classList.add('selected');
    }
    updateCounts();
  }

  function updateCounts() {
    const sel = selection.size;
    selectedCount.textContent = String(sel);
    countChip.textContent = `${images.length} 张`;
    selectAll.checked = images.length > 0 && sel === images.length;
    downloadBtn.disabled = sel === 0;
    zipBtn.disabled = sel === 0;
  }

  // ---------- 事件 ----------
  function bindEvents() {
    selectAll.addEventListener('change', () => {
      const on = selectAll.checked;
      images.forEach((_, i) => {
        const card = grid.querySelector(`[data-index="${i}"]`);
        if (on) { selection.add(i); card && card.classList.add('selected'); }
        else { selection.delete(i); card && card.classList.remove('selected'); }
      });
      updateCounts();
    });

    clearBtn.addEventListener('click', () => {
      selection.clear();
      grid.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
      updateCounts();
    });

    downloadBtn.addEventListener('click', downloadSelected);
    zipBtn.addEventListener('click', downloadZip);

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  }

  // ---------- Lightbox ----------
  function openLightbox(url) {
    lightboxImg.src = url;
    lightbox.hidden = false;
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = '';
  }

  // ---------- 下载 ----------
  async function downloadSelected() {
    const idxs = [...selection].sort((a, b) => a - b);
    if (!idxs.length) { showToast('请先选择要下载的图片'); return; }

    downloadBtn.disabled = true;
    setProgress(true, 0, idxs.length);

    let ok = 0;
    let fail = 0;
    const baseName = safeBaseName();

    for (let k = 0; k < idxs.length; k++) {
      const img = images[idxs[k]];
      const filename = `${baseName}_${String(k + 1).padStart(2, '0')}.png`;
      progressText.textContent = `下载中 ${k + 1} / ${idxs.length}`;

      try {
        const res = await chrome.runtime.sendMessage({ type: 'downloadImage', url: img.url, filename });
        if (res && res.ok) ok++;
        else fail++;
      } catch (_) {
        fail++;
      }
      setProgressBar((k + 1) / idxs.length);
      await sleep(120); // 轻微间隔，避免触发浏览器下载风暴拦截
    }

    setProgress(false);
    downloadBtn.disabled = false;
    showToast(fail ? `下载完成：成功 ${ok} 张，失败 ${fail} 张` : `下载完成：成功 ${ok} 张`);
  }

  // 打包下载为 ZIP：逐张经 background 转 PNG → 加入 JSZip → 生成压缩包下载
  async function downloadZip() {
    const idxs = [...selection].sort((a, b) => a - b);
    if (!idxs.length) { showToast('请先选择要下载的图片'); return; }
    if (typeof JSZip === 'undefined') { showToast('ZIP 组件未加载，请重新加载扩展'); return; }

    zipBtn.disabled = true;
    downloadBtn.disabled = true;
    setProgress(true, 0, idxs.length);

    const zip = new JSZip();
    const baseName = safeBaseName();
    let ok = 0;
    let fail = 0;

    for (let k = 0; k < idxs.length; k++) {
      const img = images[idxs[k]];
      const filename = `${baseName}_${String(k + 1).padStart(2, '0')}.png`;
      progressText.textContent = `打包中 ${k + 1} / ${idxs.length}`;

      try {
        const res = await chrome.runtime.sendMessage({ type: 'fetchImageAsPng', url: img.url });
        if (res && res.ok && res.dataUrl) {
          const base64 = res.dataUrl.split(',')[1] || '';
          if (base64) {
            zip.file(filename, base64, { base64: true });
            ok++;
          } else {
            fail++;
          }
        } else {
          fail++;
        }
      } catch (_) {
        fail++;
      }
      setProgressBar((k + 1) / idxs.length);
      await sleep(80);
    }

    if (!ok) {
      setProgress(false);
      zipBtn.disabled = false;
      downloadBtn.disabled = false;
      showToast('打包失败：没有成功获取任何图片');
      return;
    }

    progressText.textContent = '正在生成 ZIP 文件…';
    setProgressBar(0.97);
    try {
      // PNG 本身已无损压缩，使用 STORE 避免二次压缩耗时
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: `${baseName}.zip`, conflictAction: 'uniquify', saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showToast(`打包完成：共 ${ok} 张图片${fail ? `，跳过 ${fail} 张` : ''}`);
    } catch (e) {
      showToast('生成 ZIP 失败：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      setProgress(false);
      zipBtn.disabled = false;
      downloadBtn.disabled = false;
    }
  }

  function safeBaseName() {
    let name = (meta.title || '商品图片').trim();
    name = name.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim();
    if (!name) name = '商品图片';
    return name.slice(0, 50);
  }

  // ---------- UI 辅助 ----------
  let toastTimer = null;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }

  function setProgress(show, ratio = 0, total = 0) {
    progress.hidden = !show;
    if (show) {
      setProgressBar(ratio);
      progressText.textContent = `下载中 0 / ${total}`;
    }
  }
  function setProgressBar(ratio) {
    progressBar.style.width = `${Math.round(ratio * 100)}%`;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  load();
})();
