/* ==========================================================================
   电商图片提取下载器 — 官网交互脚本
   负责：移动端汉堡菜单、导航点击收起、页面加载淡入
   ========================================================================== */

(function () {
  'use strict';

  var navToggle = document.getElementById('navToggle');
  var navMenu = document.getElementById('navMenu');

  /* 汉堡菜单：展开 / 收起移动端导航 */
  function toggleMenu() {
    var isOpen = navMenu.classList.toggle('open');
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    navToggle.setAttribute('aria-label', isOpen ? '收起菜单' : '展开菜单');
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', toggleMenu);

    /* 点击导航链接后自动收起菜单（移动端） */
    navMenu.addEventListener('click', function (e) {
      if (e.target.classList.contains('nav__link')) {
        navMenu.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.setAttribute('aria-label', '展开菜单');
      }
    });
  }

  /* 页面加载完成后，为 Hero 区添加淡入动画 */
  var hero = document.querySelector('.hero__inner');
  if (hero) {
    window.addEventListener('load', function () {
      hero.style.opacity = '0';
      hero.style.transform = 'translateY(12px)';
      hero.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      requestAnimationFrame(function () {
        hero.style.opacity = '1';
        hero.style.transform = 'translateY(0)';
      });
    });
  }
})();
