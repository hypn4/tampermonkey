// ==UserScript==
// @name         치지직 통나무 파워 자동 획득
// @name:en      CHZZK Auto Log Power Claim
// @namespace    https://github.com/hypn4/tampermonkey
// @version      0.1.0
// @description  이벤트 훅 기반으로 치지직 라이브의 통나무 파워 claim 을 자동 획득합니다. setInterval 폴링 없이 SPA 의 자체 요청·사용자 액션·시청 하트비트·DOM 뮤테이션에 편승합니다.
// @description:en Hook-based auto-claim for CHZZK 통나무 파워 (log power). No polling; piggybacks on SPA fetches, user-action responses, awt heartbeat, and DOM mutations.
// @author       whales
// @match        https://chzzk.naver.com/*
// @icon         https://chzzk.naver.com/favicon.ico
// @homepageURL  https://github.com/hypn4/tampermonkey
// @supportURL   https://github.com/hypn4/tampermonkey/issues
// @updateURL    https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-log-power.user.js
// @downloadURL  https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-auto-log-power.user.js
// @license      MIT
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const API = 'https://api.chzzk.naver.com';
    const LOG_POWER_GET_RE  = /\/service\/v1\/channels\/([0-9a-f]+)\/log-power(?:\?.*)?$/i;
    const HEARTBEAT_RE      = /\/polling\/v1\/watch-event\/live(?:\?.*)?$/i;
    const ACTION_RE         = /\/(follow|unfollow|followings?|donations?|donate|subscriptions?|subscribe|gift|gifts|subscribe-gift)\b/i;
    const LOG_POWER_PATH_RE = /\/log-power\//i; // exclude log-power sub-paths from ACTION match
    const CERTIFY_TEXT_RE   = /통나무|파워\s*획득|시청\s*인증|인증하기/;
    const POWER_BUTTON_SEL  = '[class*="live_chatting_power_button"]';
    const PROVOKE_COOLDOWN_MS = 1500;

    const state = {
        inflightPUT: new Set(),
        lastHourTriggered: -1,
        provokeCooldown: new Map(),
        claimedAudit: [],
    };

    function debug() { return !!window.__chzzkAutoLogPowerDebug; }
    function log(...a) { if (debug()) { try { console.log('[chzzk-logpower]', ...a); } catch (_) {} } }

    function channelIdFromPath() {
        const m = location.pathname.match(/\/live\/([0-9a-f]+)/i);
        return m ? m[1] : null;
    }
    function channelIdFromUrl(url) {
        const m = String(url).match(/\/channels\/([0-9a-f]+)\/log-power/i);
        return m ? m[1] : null;
    }

    function shouldClaim(c) {
        if (!c || !c.claimId) return false;
        if (c.state !== 'COMPLIED') return false;
        if (c.claimDate) return false;
        if (c.expiryDate) {
            const t = Date.parse(c.expiryDate);
            if (Number.isFinite(t) && t <= Date.now()) return false;
        }
        return true;
    }

    // ---- use captured originals so our internal calls bypass our own hooks ----
    const originalFetch = window.fetch ? window.fetch.bind(window) : null;

    async function putClaim(channelId, claim) {
        if (!channelId || !claim || !claim.claimId) return;
        if (state.inflightPUT.has(claim.claimId)) return;
        state.inflightPUT.add(claim.claimId);
        const url = `${API}/service/v1/channels/${channelId}/log-power/claims/${encodeURIComponent(claim.claimId)}`;
        try {
            const res = await originalFetch(url, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            const text = await res.text();
            let amount = null;
            try { amount = JSON.parse(text)?.content?.amount ?? null; } catch (_) {}
            state.claimedAudit.push({
                at: Date.now(), channelId,
                claimId: claim.claimId, claimType: claim.claimType,
                expected: claim.amount, received: amount,
                status: res.status,
            });
            log('claimed', claim.claimType, 'expected', claim.amount, 'received', amount, 'status', res.status);
            if (res.ok) scheduleBannerDismiss();
        } catch (e) {
            log('claim error', e);
        } finally {
            state.inflightPUT.delete(claim.claimId);
        }
    }

    // Click the "배달 완료! 받기" banner button if visible so SPA clears its local state.
    // Idempotent: clicking after our PUT triggers a no-op PUT (amount:0) that the UI uses
    // to transition to the dismissed state. Safe if banner represents a still-pending
    // native claim (normal claim flow runs).
    function clickPowerBanner() {
        const buttons = document.querySelectorAll(POWER_BUTTON_SEL);
        for (const b of buttons) {
            if (!(b.offsetWidth && b.offsetHeight)) continue;
            try {
                b.click();
                log('power banner dismissed');
                return true;
            } catch (e) { log('banner click error', e); }
        }
        return false;
    }

    // Bounded one-shot retry. Not a polling loop: each tick schedules at most one
    // successor, and both success and max-attempts terminate the chain.
    function scheduleBannerDismiss(maxAttempts = 20, intervalMs = 200) {
        let attempts = 0;
        const tick = () => {
            if (clickPowerBanner()) return;
            if (++attempts < maxAttempts) setTimeout(tick, intervalMs);
        };
        tick();
    }

    function processClaimsBody(bodyText, url) {
        try {
            const cid = channelIdFromUrl(url);
            if (!cid) return;
            const data = JSON.parse(bodyText);
            const claims = data && data.content && data.content.claims;
            if (!Array.isArray(claims) || claims.length === 0) return;
            for (const c of claims) if (shouldClaim(c)) putClaim(cid, c);
        } catch (e) {
            log('parse error', e);
        }
    }

    function provokeLogPowerRefresh(channelId) {
        if (!channelId) channelId = channelIdFromPath();
        if (!channelId) return;
        const last = state.provokeCooldown.get(channelId) || 0;
        if (Date.now() - last < PROVOKE_COOLDOWN_MS) return;
        state.provokeCooldown.set(channelId, Date.now());
        if (!originalFetch) return;
        originalFetch(`${API}/service/v1/channels/${channelId}/log-power`, { credentials: 'include' })
            .then(r => (r && r.ok) ? r.text().then(t => processClaimsBody(t, r.url)) : null)
            .catch(e => log('provoke error', e));
    }

    function maybeReadAwt(bodyText) {
        try {
            const b = JSON.parse(bodyText);
            const awt = b && b.payload && b.payload.awt;
            if (typeof awt !== 'number') return;
            const hour = Math.floor(awt / 3600);
            if (hour >= 1 && hour > state.lastHourTriggered) {
                state.lastHourTriggered = hour;
                log('awt crossed hour', hour, '→ provoke');
                provokeLogPowerRefresh();
            }
        } catch (_) { /* ignore */ }
    }

    // ---------------- fetch patch ----------------
    if (originalFetch) {
        window.fetch = async function patchedFetch(input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const method = String(
                (init && init.method) ||
                (input instanceof Request ? input.method : 'GET')
            ).toUpperCase();

            // heartbeat: read request body for awt
            if (method === 'POST' && url && HEARTBEAT_RE.test(url)) {
                let bodyStr = null;
                try {
                    if (init && typeof init.body === 'string') bodyStr = init.body;
                    else if (input instanceof Request) bodyStr = await input.clone().text();
                } catch (_) { bodyStr = null; }
                if (bodyStr) maybeReadAwt(bodyStr);
            }

            const response = await originalFetch(input, init);

            try {
                if (method === 'GET' && url && LOG_POWER_GET_RE.test(url) && response.ok) {
                    const t = await response.clone().text();
                    processClaimsBody(t, url);
                } else if (
                    url && response.ok &&
                    (method === 'POST' || method === 'PUT' || method === 'DELETE') &&
                    ACTION_RE.test(url) &&
                    !LOG_POWER_PATH_RE.test(url) &&
                    /api\.chzzk\.naver\.com/.test(url)
                ) {
                    provokeLogPowerRefresh();
                }
            } catch (e) { log('fetch hook error', e); }

            return response;
        };
    }

    // ---------------- XHR patch ----------------
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
            try {
                this.__cpz_method = String(method || '').toUpperCase();
                this.__cpz_url = String(url || '');
            } catch (_) { /* noop */ }
            return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
            const method = this.__cpz_method;
            const url = this.__cpz_url;
            if (method === 'POST' && url && HEARTBEAT_RE.test(url) && typeof body === 'string') {
                maybeReadAwt(body);
            }
            if (url) {
                this.addEventListener('load', () => {
                    try {
                        if (this.status < 200 || this.status >= 300) return;
                        if (method === 'GET' && LOG_POWER_GET_RE.test(url)) {
                            processClaimsBody(this.responseText, url);
                        } else if (
                            (method === 'POST' || method === 'PUT' || method === 'DELETE') &&
                            ACTION_RE.test(url) &&
                            !LOG_POWER_PATH_RE.test(url) &&
                            /api\.chzzk\.naver\.com/.test(url)
                        ) {
                            provokeLogPowerRefresh();
                        }
                    } catch (e) { log('xhr hook error', e); }
                });
            }
            return origSend.apply(this, arguments);
        };
    }

    // ---------------- MutationObserver for certify button ----------------
    let moScheduled = false;
    function containsPowerBanner(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches && node.matches(POWER_BUTTON_SEL)) return true;
        return !!(node.querySelector && node.querySelector(POWER_BUTTON_SEL));
    }
    function handleMutations(muts) {
        if (moScheduled) return;
        for (const mut of muts) {
            for (const n of mut.addedNodes) {
                if (n.nodeType !== 1) continue;

                // Power banner DOM just appeared → refresh claims state AND click to dismiss.
                if (containsPowerBanner(n)) {
                    moScheduled = true;
                    queueMicrotask(() => {
                        moScheduled = false;
                        log('power banner rendered → provoke + click');
                        provokeLogPowerRefresh();
                        clickPowerBanner();
                    });
                    return;
                }

                // Fallback: any nearby text that hints at log-power UI → only refresh.
                const txt = (n.textContent || '');
                if (txt && txt.length < 300 && CERTIFY_TEXT_RE.test(txt)) {
                    moScheduled = true;
                    queueMicrotask(() => {
                        moScheduled = false;
                        log('mutation matched → provoke');
                        provokeLogPowerRefresh();
                    });
                    return;
                }
            }
        }
    }
    function startObserver() {
        try {
            new MutationObserver(handleMutations).observe(document.body, { childList: true, subtree: true });
        } catch (e) { log('observer error', e); }
    }
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

    // ---------------- debug handle ----------------
    try {
        Object.defineProperty(window, '__chzzkAutoLogPower', {
            configurable: true,
            value: {
                get inflight() { return [...state.inflightPUT]; },
                get audit() { return state.claimedAudit.slice(); },
                get lastHourTriggered() { return state.lastHourTriggered; },
                provoke: provokeLogPowerRefresh,
                channelId: channelIdFromPath,
                dismissBanner: clickPowerBanner,
            },
        });
    } catch (_) { /* ignore */ }

    log('installed at', location.href);
})();
