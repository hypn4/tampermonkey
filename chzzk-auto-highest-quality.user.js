// ==UserScript==
// @name         치지직 라이브 자동 최고화질
// @name:en      CHZZK Auto Highest Quality
// @namespace    https://github.com/hypn4/tampermonkey
// @version      0.1.0
// @description  치지직 라이브 HLS 마스터 매니페스트를 가로채 최고 해상도 variant 만 남겨 항상 최고화질로 재생합니다.
// @description:en Intercepts CHZZK live HLS master manifests and keeps only the highest-resolution variant so playback is locked to the highest quality.
// @author       whales
// @match        https://chzzk.naver.com/*
// @match        https://livecloud.pstatic.net/*
// @icon         https://chzzk.naver.com/favicon.ico
// @homepageURL  https://github.com/hypn4/tampermonkey
// @supportURL   https://github.com/hypn4/tampermonkey/issues
// @updateURL    https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-highest-quality.user.js
// @downloadURL  https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-highest-quality.user.js
// @license      MIT
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const MASTER_RE = /_hls_playlist\.m3u8$/i;
    const DEBUG_FLAG = '__chzzkAutoHQDebug';

    const state = {
        lastPick: null,
        rewriteCount: 0,
    };

    function log(...args) {
        if (window[DEBUG_FLAG]) {
            try { console.log('[chzzk-auto-hq]', ...args); } catch (_) { /* noop */ }
        }
    }

    function stripQuery(url) {
        if (typeof url !== 'string') return '';
        const q = url.indexOf('?');
        const h = url.indexOf('#');
        let end = url.length;
        if (q >= 0) end = Math.min(end, q);
        if (h >= 0) end = Math.min(end, h);
        return url.slice(0, end);
    }

    function isMasterUrl(url) {
        return MASTER_RE.test(stripQuery(url));
    }

    function parseAttrs(infLine) {
        // "#EXT-X-STREAM-INF:BANDWIDTH=8384000,CODECS=\"avc1,mp4a\",RESOLUTION=1920x1080,FRAME-RATE=60.00"
        const colon = infLine.indexOf(':');
        const attrs = {};
        if (colon < 0) return attrs;
        const body = infLine.slice(colon + 1);
        const re = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
        let m;
        while ((m = re.exec(body)) !== null) {
            let value = m[2];
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            attrs[m[1]] = value;
        }
        return attrs;
    }

    function variantScore(attrs) {
        let pixels = 0;
        if (attrs.RESOLUTION) {
            const parts = attrs.RESOLUTION.toLowerCase().split('x');
            const w = parseInt(parts[0], 10) || 0;
            const h = parseInt(parts[1], 10) || 0;
            pixels = w * h;
        }
        const bw = parseInt(attrs.BANDWIDTH, 10) || 0;
        const fps = parseFloat(attrs['FRAME-RATE']) || 0;
        return { pixels, bw, fps };
    }

    function rewriteMaster(text) {
        if (typeof text !== 'string' || text.indexOf('#EXT-X-STREAM-INF') < 0) {
            return text;
        }
        const lines = text.split(/\r?\n/);
        const header = [];
        const pairs = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                // Find the next non-empty, non-comment line as the variant URL
                let j = i + 1;
                while (j < lines.length && (lines[j].trim() === '' || lines[j].startsWith('#'))) {
                    j++;
                }
                if (j >= lines.length) break;
                pairs.push({ inf: line, url: lines[j], attrs: parseAttrs(line) });
                i = j;
            } else {
                header.push(line);
            }
        }

        if (pairs.length === 0) return text;

        // Filter variants with a RESOLUTION (exclude audio-only)
        const withRes = pairs.filter(p => p.attrs.RESOLUTION);
        const candidates = withRes.length > 0 ? withRes : pairs;

        let best = candidates[0];
        let bestScore = variantScore(best.attrs);
        for (let i = 1; i < candidates.length; i++) {
            const s = variantScore(candidates[i].attrs);
            if (
                s.pixels > bestScore.pixels ||
                (s.pixels === bestScore.pixels && s.bw > bestScore.bw) ||
                (s.pixels === bestScore.pixels && s.bw === bestScore.bw && s.fps > bestScore.fps)
            ) {
                best = candidates[i];
                bestScore = s;
            }
        }

        state.lastPick = {
            resolution: best.attrs.RESOLUTION || null,
            bandwidth: parseInt(best.attrs.BANDWIDTH, 10) || null,
            frameRate: parseFloat(best.attrs['FRAME-RATE']) || null,
            url: best.url,
        };
        state.rewriteCount += 1;

        // Persist preference (best-effort, does not affect manifest logic)
        recordPreference(best.attrs);

        // Rebuild manifest: keep header (global tags) + exactly one variant
        const out = header.slice();
        while (out.length && out[out.length - 1].trim() === '') out.pop();
        out.push(best.inf);
        out.push(best.url);
        out.push('');
        return out.join('\n');
    }

    function recordPreference(attrs) {
        try {
            if (!attrs.RESOLUTION) return;
            const parts = attrs.RESOLUTION.toLowerCase().split('x');
            const width = parseInt(parts[0], 10);
            const height = parseInt(parts[1], 10);
            if (!width || !height) return;
            const label = `${height}p`;
            localStorage.setItem(
                'live-player-video-track',
                JSON.stringify({ label, width, height })
            );
        } catch (_) { /* ignore storage errors */ }
    }

    // ---------------- fetch patch ----------------
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
        window.fetch = async function patchedFetch(input, init) {
            const response = await origFetch(input, init);
            let url = '';
            try {
                if (typeof input === 'string') url = input;
                else if (input && typeof input.url === 'string') url = input.url;
                if (!url && response && response.url) url = response.url;
            } catch (_) { /* noop */ }

            if (!isMasterUrl(url)) return response;

            try {
                const body = await response.clone().text();
                const rewritten = rewriteMaster(body);
                if (rewritten === body) return response;
                log('fetch rewrite', url, state.lastPick);
                const headers = new Headers(response.headers);
                return new Response(rewritten, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                });
            } catch (err) {
                log('fetch rewrite failed, passing through', err);
                return response;
            }
        };
    }

    // ---------------- XHR patch ----------------
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;

        XHR.prototype.open = function patchedOpen(method, url) {
            try { this.__chzzkHQUrl = typeof url === 'string' ? url : String(url); } catch (_) { /* noop */ }
            return origOpen.apply(this, arguments);
        };

        XHR.prototype.send = function patchedSend() {
            const url = this.__chzzkHQUrl;
            if (url && isMasterUrl(url)) {
                const xhr = this;
                xhr.addEventListener('readystatechange', function onState() {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status < 200 || xhr.status >= 300) return;
                    try {
                        const resp = xhr.responseType;
                        let text = null;
                        if (!resp || resp === 'text' || resp === '') {
                            try { text = xhr.responseText; } catch (_) { text = null; }
                        } else if (resp === 'arraybuffer' && xhr.response) {
                            try { text = new TextDecoder('utf-8').decode(new Uint8Array(xhr.response)); } catch (_) { text = null; }
                        } else if (resp === 'blob' || resp === 'json' || resp === 'document') {
                            // These response types are unusual for m3u8; skip.
                            return;
                        }
                        if (text == null) return;
                        const rewritten = rewriteMaster(text);
                        if (rewritten === text) return;
                        log('xhr rewrite', url, state.lastPick);
                        try {
                            Object.defineProperty(xhr, 'responseText', {
                                configurable: true,
                                get() { return rewritten; },
                            });
                        } catch (_) { /* ignore */ }
                        try {
                            Object.defineProperty(xhr, 'response', {
                                configurable: true,
                                get() { return rewritten; },
                            });
                        } catch (_) { /* ignore */ }
                    } catch (err) {
                        log('xhr rewrite error', err);
                    }
                });
            }
            return origSend.apply(this, arguments);
        };
    }

    // Expose a debug handle
    try {
        Object.defineProperty(window, '__chzzkAutoHQ', {
            configurable: true,
            value: {
                get lastPick() { return state.lastPick; },
                get rewriteCount() { return state.rewriteCount; },
                rewriteMaster,
                isMasterUrl,
            },
        });
    } catch (_) { /* ignore */ }

    log('installed at', location.href);
})();
