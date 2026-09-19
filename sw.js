'use strict';

/*
 * sw.js
 * PWA対応のためのService Worker。
 * このアプリ自身の静的ファイル(HTML/CSS/JS/アイコン)のみをキャッシュし、
 * オフラインでも起動・閲覧できるようにする。
 * Open Food Facts / Google Gemini などの外部API通信はキャッシュ対象外とし、
 * 常にネットワークへそのまま流す（オフライン時はアプリ側のエラーハンドリングに委ねる）。
 */

const CACHE_NAME = 'diet-app-cache-v1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './data.js',
  './api.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 自分自身のオリジン以外(外部API・CDN)はService Workerで扱わず、通常のネットワーク動作に任せる。
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
