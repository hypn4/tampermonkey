// ==UserScript==
// @name         치지직 그리드 없는 고화질
// @name:en      CHZZK High Quality Without Grid
// @namespace    https://github.com/hypn4/tampermonkey
// @version      0.2.0
// @description  치지직 라이브의 P2P 재생 표시를 제거하여 그리드 설치 없이 일반 CDN으로 고화질을 선택합니다.
// @description:en Uses the existing live CDN playlists instead of the native P2P connector, keeping high-quality tracks selectable.
// @author       whales
// @match        https://chzzk.naver.com/*
// @icon         https://chzzk.naver.com/favicon.ico
// @homepageURL  https://github.com/hypn4/tampermonkey
// @supportURL   https://github.com/hypn4/tampermonkey/issues
// @updateURL    https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-no-grid.user.js
// @downloadURL  https://raw.githubusercontent.com/hypn4/tampermonkey/main/chzzk-no-grid.user.js
// @license      MIT
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // Site-specific contract: update these keys/hosts only after inspecting a
    // fresh decoded playback payload. Never remove arbitrary "p2p*" fields.
    const P2P_PATH_FIELDS = ['p2pPath', 'p2pPathUrlEncoding'];
    const CDN_HOST = /^(?:[a-z0-9-]+-)?livecloud\.pstatic\.net$/i;

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isLivePlayback(value) {
        if (!isRecord(value) || !isRecord(value.live) || !isRecord(value.meta) ||
            !Array.isArray(value.media)) return false;
        const id = value.meta.liveId;
        return (typeof id === 'string' && id.length > 0) ||
            (Number.isSafeInteger(id) && id > 0);
    }

    function isCdnMedia(media) {
        if (media.protocol !== 'HLS' || typeof media.path !== 'string') return false;
        try {
            const url = new URL(media.path);
            return url.protocol === 'https:' && CDN_HOST.test(url.hostname);
        } catch (_) {
            return false;
        }
    }

    function hasP2PFields(value) {
        return P2P_PATH_FIELDS.some(field => Object.hasOwn(value, field));
    }

    function withoutP2PFields(value) {
        if (!hasP2PFields(value)) return value;
        const result = { ...value };
        for (const field of P2P_PATH_FIELDS) delete result[field];
        return result;
    }

    // Pure copy-on-write conversion. Keep signed URLs, unknown fields and
    // unaffected objects intact, including results retained by earlier hooks.
    function rewritePlayback(value) {
        if (!isLivePlayback(value)) return value;
        let mediaList = value.media;
        for (let i = 0; i < value.media.length; i++) {
            const media = value.media[i];
            if (!isRecord(media) || !Array.isArray(media.encodingTrack) ||
                !media.encodingTrack.every(isRecord)) return value;

            const tracks = media.encodingTrack;
            if (!hasP2PFields(media) && !tracks.some(hasP2PFields)) continue;
            // A global p2p=false with an unconverted P2P media is inconsistent.
            // Unknown hosts/protocols/layouts leave the WHOLE payload unchanged.
            if (!isCdnMedia(media)) return value;

            let trackList = tracks;
            for (let j = 0; j < tracks.length; j++) {
                const track = withoutP2PFields(tracks[j]);
                if (track === tracks[j]) continue;
                if (trackList === tracks) trackList = tracks.slice();
                trackList[j] = track;
            }
            if (mediaList === value.media) mediaList = value.media.slice();
            mediaList[i] = { ...withoutP2PFields(media), encodingTrack: trackList };
        }
        if (mediaList === value.media) return value;
        return { ...value, meta: { ...value.meta, p2p: false }, media: mediaList };
    }

    function installParseHook() {
        const originalParse = JSON.parse;
        // Playback metadata is decoded before this boundary; hooking transport
        // URLs alone cannot reliably identify its plaintext.
        JSON.parse = function parse(text, reviver) {
            // Keep native parse/reviver exceptions outside transformation recovery.
            const value = Reflect.apply(originalParse, this, arguments);
            // Revivers can retain, freeze or replace objects. Preserve that
            // contract instead of altering their returned values or identities.
            if (typeof reviver === 'function') return value;
            try {
                return rewritePlayback(value);
            } catch (_) {
                // Transformation failure must not turn valid JSON into an error.
                // No input object has been mutated, so returning it is safe.
                return value;
            }
        };
    }

    installParseHook();
})();
