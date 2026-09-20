// ==UserScript==
// @name         치지직 광고 차단 감지 우회
// @name:en      CHZZK Ad-Block Detection Bypass
// @namespace    https://github.com/hypn4/tampermonkey
// @version      0.3.0
// @description  광고 편성 게이트(seoraksan)를 끄고 광고차단 탐지 프로브를 무력화합니다. AD_NOT_DISPLAYED 로 인한 재생 중단과 dab:true 로 인한 광고 차단 안내 레이어·화질 강제 저하를 모두 막습니다.
// @description:en Turns off the CHZZK ad-schedule gate (seoraksan) and neutralizes the ad-block detection probes. Prevents both the AD_NOT_DISPLAYED playback kill and the dab:true ad-block layer / forced low resolution.
// @author       whales
// @match        https://chzzk.naver.com/*
// @icon         https://chzzk.naver.com/favicon.ico
// @homepageURL  https://github.com/hypn4/tampermonkey
// @supportURL   https://github.com/hypn4/tampermonkey/issues
// @updateURL    https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-adblock-detect-bypass.user.js
// @downloadURL  https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-adblock-detect-bypass.user.js
// @license      MIT
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // --------------------------------------------------------------------------------------------
    // Two independent paths render the same "광고 차단 프로그램을 사용 중이신가요?" layer. They are
    // told apart by what happens to playback:
    //
    //   1. AD_NOT_DISPLAYED  -> player.src = '' + layer.  Playback dies (paused, readyState 0).
    //      An ad break is scheduled, the ad is fetched fine through CHZZK's own tunnel, but the GFP
    //      SDK inspects the ad DOM after AD_STARTED, finds it hidden/detached (cosmetic filtering),
    //      and dispatches AD_NOT_DISPLAYED.
    //      Fix: turn off the ad-schedule gate so no ad break ever exists (see GATE below).
    //
    //   2. dab:true          -> layer + forceLowResolution.  Playback continues, pinned to 360p.
    //      The detector probes three nam.veta.naver.com endpoints; a blocked request (status 0) or a
    //      tampered XHR instance counts as "ad blocker present", which is encoded into the `dt`
    //      query param of the tunneled live-detail call, and the server answers dab:true.
    //      Fix: point the probes at a same-origin always-200 resource so the verdict is "clean"
    //      (see PROBE below), with a dab rewrite as fallback (see DAB below).
    //
    // Kill switch: localStorage.setItem('__chzzkAdbOff', '1') then reload to disable every hook.
    // --------------------------------------------------------------------------------------------

    const LAYER_SEL = '[data-nlog-area="ad_blocking_info_layer"]';
    // The ad-schedule gate response is ~95 bytes. Bigger payloads take the dab path instead.
    const MAX_GATE_BYTES = 800;
    // Above this, a decrypted payload is not an API JSON response (live-detail is ~17KB), so don't
    // spend a UTF-8 decode on it - the tunnel can carry media too.
    const MAX_INSPECT_BYTES = 262144;
    // The three probe endpoints the detector calls with OPTIONS. Real ad traffic goes through the
    // tunnel (/service/t/...), so it never matches these.
    const PROBE_RE = /^https?:\/\/nam\.veta\.naver\.com\/(gfp\/v1|call|vas)(?:\?|$)/i;

    const state = {
        probeRedirects: 0,
        decryptCalls: 0,
        inspected: 0,
        gateFlips: 0,
        dabFlips: 0,
        gateSkipped: 0,
        layerSeen: 0,
        errors: [],
    };

    function debug() { return !!window.__chzzkAdbBypassDebug; }
    function log(...a) { if (debug()) { try { console.log('[chzzk-adb]', ...a); } catch (_) {} } }
    function fail(where, err) {
        state.errors.push(where + ': ' + err);
        try { console.error('[chzzk-adb] ' + where, err); } catch (_) {}
    }

    try {
        if (localStorage.getItem('__chzzkAdbOff') === '1') {
            try { console.warn('[chzzk-adb] disabled by __chzzkAdbOff'); } catch (_) {}
            return;
        }
    } catch (_) { /* storage blocked; carry on */ }

    // ---------------- PROBE: redirect the detector's probes ----------------
    // ce(url, 'OPTIONS') in the detector only checks `q.status !== 0`, so a same-origin resource that
    // always answers 200 makes the verdict "not blocked" without ever contacting naver's ad server.
    // OPTIONS on /favicon.ico returns 200, so the method does not need changing.
    //
    // Deliberately minimal. An earlier version wrapped send(), attached readystatechange listeners
    // and defined own `response`/`responseText` accessors, and that build made the player vanish
    // entirely under Tampermonkey. Keep this to the URL swap:
    //   - do not wrap send()
    //   - do not attach listeners
    //   - do not create own properties on the instance; those named setRequestHeader, status,
    //     statusText, readyState, response, responseURL or responseXML are exactly what the
    //     detector reads as tampering (and would make it report "blocked").
    try {
        const XHR = window.XMLHttpRequest;
        if (XHR && XHR.prototype && typeof XHR.prototype.open === 'function') {
            const stub = location.origin + '/favicon.ico';
            const origOpen = XHR.prototype.open;
            XHR.prototype.open = function patchedOpen(method, url) {
                try {
                    if (PROBE_RE.test(String(url))) {
                        // Assigning to arguments still changes what apply() forwards; only the
                        // parameter binding is unlinked in strict mode.
                        arguments[1] = stub;
                        state.probeRedirects += 1;
                        log('probe redirected:', String(url));
                    }
                } catch (_) { /* noop */ }
                return origOpen.apply(this, arguments);
            };
            log('probe redirect installed');
        }
    } catch (e) {
        fail('install probe redirect', e);
    }

    // ---------------- GATE: ad-schedule gate response ----------------
    // GET /service/v1/seoraksan?pgId=..&pgType=CHZZK_LIVE decides pre/mid-roll. The field names are
    // disguised as unrelated ones:
    //   content.livePlaybackJson.liveId        -> preRoll
    //   content.livePlaybackJson.chatChannelId -> midRoll
    // with content.playerAdDisplayResponse.{preRoll,midRoll} as an alternate shape. When pre/mid/post
    // are all false the SPA returns early and never sets adsController.srcObject, so
    // AdBreakReady -> findAdScheduleManager -> AD_NOT_DISPLAYED cannot happen. The app's own catch
    // branch already sets all three false and still marks the player loaded, so this is a state it
    // handles natively.
    function gateOf(content) {
        if (!content || typeof content !== 'object') return null;
        if (content.playerAdDisplayResponse) {
            return { obj: content.playerAdDisplayResponse, pre: 'preRoll', mid: 'midRoll' };
        }
        if (content.livePlaybackJson) {
            return { obj: content.livePlaybackJson, pre: 'liveId', mid: 'chatChannelId' };
        }
        return null;
    }

    // Returns the rewritten JSON text, or null when `text` is not a gate response worth rewriting.
    function rewriteGateText(text) {
        let data;
        try { data = JSON.parse(text); } catch (_) { return null; }
        const gate = gateOf(data && data.content);
        if (!gate) return null;
        // Strong discriminator: only the gate response carries these two as booleans. In a real
        // live-detail payload liveId is a number and chatChannelId a string, so they cannot match.
        if (typeof gate.obj[gate.pre] !== 'boolean' || typeof gate.obj[gate.mid] !== 'boolean') {
            state.gateSkipped += 1;
            return null;
        }
        if (gate.obj[gate.pre] === false && gate.obj[gate.mid] === false) return null; // already off
        gate.obj[gate.pre] = false;
        gate.obj[gate.mid] = false;
        state.gateFlips += 1;
        log('ad gate disabled via', gate.pre, '/', gate.mid);
        return JSON.stringify(data);
    }

    // ---------------- DAB: fallback if the probe redirect is defeated ----------------
    // Surgical string replace rather than JSON.parse/stringify: `dab` is a single scalar with an
    // unambiguous name, and re-serializing ~17KB of unrelated data is the bigger risk.
    const DAB_ANY_RE = /"dab"\s*:\s*true/;
    const DAB_ALL_RE = /"dab"\s*:\s*true/g;

    function rewriteDabText(text) {
        if (text.indexOf('"dab"') < 0) return null;      // cheap pre-filter
        if (!DAB_ANY_RE.test(text)) return null;         // already false
        state.dabFlips += 1;
        log('dab:true rewritten to false - probe redirect did not take effect');
        return text.replace(DAB_ALL_RE, '"dab":false');
    }

    // ---------------- tunnel path: crypto.subtle.decrypt ----------------
    // The tunnel parses its plaintext with a hand-rolled JSON parser, so JSON.parse / fetch / XHR
    // hooks never see these payloads. The AES-GCM decrypt output is the only readable point.
    //
    // Assign a plain writable data property. CHZZK's crypto integrity probe flags *non-configurable
    // accessors* on window.crypto / crypto.subtle, so never use defineProperty with a getter here.
    try {
        const subtle = window.crypto && window.crypto.subtle;
        if (subtle && typeof subtle.decrypt === 'function') {
            const originalDecrypt = subtle.decrypt.bind(subtle);
            subtle.decrypt = function patchedDecrypt() {
                state.decryptCalls += 1;
                return originalDecrypt.apply(null, arguments).then(function (buf) {
                    // Any throw here would reject a tunnel request and take the player down with it,
                    // so every failure mode returns the original buffer untouched.
                    try {
                        if (!buf || typeof buf.byteLength !== 'number' || buf.byteLength === 0) return buf;
                        if (buf.byteLength > MAX_INSPECT_BYTES) return buf;
                        state.inspected += 1;
                        const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
                        const rewritten = buf.byteLength <= MAX_GATE_BYTES
                            ? rewriteGateText(text)
                            : rewriteDabText(text);
                        if (rewritten === null) return buf;
                        return new TextEncoder().encode(rewritten).buffer;
                    } catch (e) {
                        fail('decrypt', e);
                        return buf;
                    }
                });
            };
            log('tunnel decrypt hook installed');
        }
    } catch (e) {
        fail('install decrypt hook', e);
    }

    // ---------------- safety net: watch for the layer ----------------
    // The layer can only render if the fixes above failed. Report it loudly rather than hiding it:
    // on the AD_NOT_DISPLAYED path player.src is already cleared and the player instance lives
    // inside a closed shadow root, so removing the layer would just leave an unexplained black
    // player and bury the failure.
    function handleLayer() {
        if (state.layerSeen) return;
        state.layerSeen += 1;
        try {
            console.warn('[chzzk-adb] ad_blocking_info_layer rendered - bypass did not take effect;'
                + ' probeRedirects=' + state.probeRedirects + ' dabFlips=' + state.dabFlips
                + ' gateFlips=' + state.gateFlips);
        } catch (_) { /* noop */ }
    }

    function startObserver() {
        try {
            if (document.querySelector(LAYER_SEL)) handleLayer();
            new MutationObserver(() => {
                if (!state.layerSeen && document.querySelector(LAYER_SEL)) handleLayer();
            }).observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { fail('observer', e); }
    }
    if (document.documentElement) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

    // ---------------- debug handle ----------------
    // Healthy state: probeRedirects >= 3, dabFlips === 0, gateFlips >= 1, layerSeen === 0, errors [].
    // dabFlips > 0 means the probe redirect was defeated and the fallback carried the load.
    try {
        Object.defineProperty(window, '__chzzkAdbBypass', {
            configurable: true,
            value: {
                version: '0.3.0',
                get probeRedirects() { return state.probeRedirects; },
                get decryptCalls() { return state.decryptCalls; },
                get inspected() { return state.inspected; },
                get gateFlips() { return state.gateFlips; },
                get dabFlips() { return state.dabFlips; },
                get gateSkipped() { return state.gateSkipped; },
                get layerSeen() { return state.layerSeen; },
                get errors() { return state.errors.slice(); },
                rewriteGateText,
                rewriteDabText,
            },
        });
    } catch (e) {
        fail('debug handle', e);
    }

    log('installed at', location.href);
})();
