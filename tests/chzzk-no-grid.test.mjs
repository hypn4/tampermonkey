import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../chzzk-no-grid.user.js', import.meta.url), 'utf8');

// Sanitized shape observed in CHZZK playback metadata. No live tokens or URLs.
function playback() {
    return {
        meta: { liveId: '123', p2p: true, playbackAuthType: 'NONE' },
        live: { status: 'STARTED', timeMachine: false },
        api: [{ name: 'qoeConfig', path: 'https://example.invalid/qoe' }],
        media: ['HLS', 'LLHLS'].map(mediaId => ({
            mediaId,
            protocol: 'HLS',
            path: `https://nvelop-livecloud.pstatic.net/chzzk/${mediaId}.m3u8?hdnts=a%2Fb~signature=unchanged`,
            p2pPath: `/connector/${mediaId}.m3u8`,
            p2pPathUrlEncoding: `/connector/${mediaId}.m3u8`,
            encodingTrack: [
                { encodingTrackId: '1080p', videoWidth: 1920, videoHeight: 1080,
                    videoFrameRate: '60.0', p2pPath: '/connector/1080p', p2pPathUrlEncoding: '/connector/1080p' },
                { encodingTrackId: '360p', videoWidth: 640, videoHeight: 360 },
                { encodingTrackId: 'audioOnly', audioOnly: true,
                    path: 'https://nvelop-livecloud.pstatic.net/audio.m3u8?signature=unchanged' },
            ],
            futureField: { keep: true },
        })),
        thumbnail: { urlTemplate: 'https://example.invalid/thumbnail/{index}' },
    };
}

function runtime({ freeze = false } = {}) {
    const context = vm.createContext({ URL });
    // A previous parser hook retaining its result models another userscript.
    vm.runInContext(`
        const nativeParse = JSON.parse;
        function freezeTree(value) {
            if (value && typeof value === 'object') {
                Object.values(value).forEach(freezeTree);
                Object.freeze(value);
            }
            return value;
        }
        JSON.parse = function (...args) {
            const value = Reflect.apply(nativeParse, this, args);
            globalThis.parsedInput = ${freeze ? 'freezeTree(value)' : 'value'};
            return value;
        };
    `, context);
    vm.runInContext(source, context);
    return {
        context,
        parse(value) {
            return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
        },
    };
}

const plain = value => JSON.parse(JSON.stringify(value));

function expectedCdnPlayback(input) {
    const expected = structuredClone(input);
    expected.meta.p2p = false;
    for (const media of expected.media) {
        delete media.p2pPath;
        delete media.p2pPathUrlEncoding;
        for (const track of media.encodingTrack) {
            delete track.p2pPath;
            delete track.p2pPathUrlEncoding;
        }
    }
    return expected;
}

test('HLS and LLHLS retain signed CDN URLs, all qualities, audio and unknown fields without mutating an earlier hook result', () => {
    const input = playback();
    const { parse, context } = runtime();
    const result = parse(input);
    assert.deepEqual(plain(result), expectedCdnPlayback(input));
    assert.deepEqual(plain(context.parsedInput), input);
    assert.notEqual(result, context.parsedInput);
    assert.equal(result.api, context.parsedInput.api);
    assert.equal(result.media[0].encodingTrack[1], context.parsedInput.media[0].encodingTrack[1]);
});

test('a frozen result from an earlier hook can be transformed without throwing or changing its objects', () => {
    const input = playback();
    const { parse, context } = runtime({ freeze: true });
    assert.deepEqual(plain(parse(input)), expectedCdnPlayback(input));
    assert.deepEqual(plain(context.parsedInput), input);
});

test('a callable reviver retains native identity and frozen-object semantics, even for playback-shaped data', () => {
    const { context } = runtime();
    context.text = JSON.stringify(playback());
    const result = vm.runInContext(`JSON.parse(text, (key, value) => {
        if (key === '') {
            globalThis.revivedRoot = value;
            Object.freeze(value.meta);
        }
        return value;
    })`, context);
    assert.equal(result, context.revivedRoot);
    assert.equal(result.meta.p2p, true);
    assert.equal(result.media[0].p2pPath, '/connector/HLS.m3u8');
});

test('malformed JSON and reviver exceptions still reach the caller', () => {
    const { context } = runtime();
    assert.throws(() => vm.runInContext('JSON.parse("{")', context), { name: 'SyntaxError' });
    vm.runInContext('globalThis.failure = new Error("reviver failure")', context);
    assert.throws(() => vm.runInContext('JSON.parse("{}", () => { throw failure; })', context),
        error => error === context.failure);
});

test('unrelated JSON and incomplete playback envelopes are returned unchanged', () => {
    const { parse, context } = runtime();
    for (const input of [
        { meta: playback().meta, media: playback().media },
        { ...playback(), live: 'STARTED' },
        { ...playback(), meta: { liveId: [], p2p: true } },
    ]) {
        const result = parse(input);
        assert.equal(result, context.parsedInput);
        assert.deepEqual(plain(result), input);
    }
});

test('an unsupported active P2P media preserves the entire payload instead of partially disabling P2P', () => {
    for (const unsupported of [
        { protocol: 'DASH' },
        { path: 'https://nvelop-livecloud.pstatic.net.example.invalid/master.m3u8' },
        { path: 'http://nvelop-livecloud.pstatic.net/master.m3u8' },
    ]) {
        const input = playback();
        Object.assign(input.media[1], unsupported);
        const { parse, context } = runtime();
        const result = parse(input);
        assert.equal(result, context.parsedInput);
        assert.deepEqual(plain(result), input);
    }
});

test('unknown track layouts do not cause a partial conversion or a parser failure', () => {
    for (const tracks of [null, {}, [null]]) {
        const input = playback();
        input.media[1].encodingTrack = tracks;
        const { parse, context } = runtime();
        const result = parse(input);
        assert.equal(result, context.parsedInput);
        assert.deepEqual(plain(result), input);
    }
});

test('already converted playback is returned by identity and remains safe with two installed hooks', () => {
    const { parse, context } = runtime();
    vm.runInContext(source, context);
    const input = expectedCdnPlayback(playback());
    const result = parse(input);
    assert.equal(result, context.parsedInput);
    assert.deepEqual(plain(result), input);
    assert.deepEqual(plain(parse(playback())), input);
});
