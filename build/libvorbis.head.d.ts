/// <reference path="../typings/webrtc/MediaStream.d.ts" />
/// <reference path="../typings/webaudioapi/waa.d.ts" />
/// <reference path="../typings/es6-promise/es6-promise.d.ts" />
/// <reference path="../src/MediaRecorder.d.ts" />
/// <reference path="../src/vorbis_encoder.d.ts" />
interface Window {
    BlobEvent: any;
}
declare var window: Window;
declare class VorbisWorkerScript {
    static createWorker(): Worker;
    static main(self: Worker): void;
    private static getCurrentScriptURL;
}
declare function noop(): void;
interface DataCallback {
    (data: ArrayBuffer): void;
}
declare class VorbisEncoder {
    private _worker;
    private _ondata;
    private _onfinish;
    constructor();
    ondata: DataCallback;
    onfinish: EventListener;
    init(channels: number, sampleRate: number, quality: number): void;
    encode(buffers: ArrayBuffer[], samples: number, channels: number): void;
    finish(): void;
    private handleEncoderMessage(ev);
}
declare enum RecordingState {
    "inactive" = 0,
    "recording" = 1,
    "paused" = 2,
}
interface VorbisMediaRecorderOptions {
}
declare function makeBlobEvent(type: string, blob: Blob): BlobEvent;
declare class VorbisMediaRecorder {
    private _state;
    private _stream;
    private _encoder;
    private _chunks;
    private _ctx;
    private _sourceNode;
    private _procNode;
    private _onstart;
    private _ondataavailable;
    private _onstop;
    constructor(stream: MediaStream, options?: VorbisMediaRecorderOptions);
    stream: MediaStream;
    mimeType: string;
    state: string;
    onstart: EventListener;
    ondataavailable: BlobEventListener;
    onstop: EventListener;
    start(timeslice?: number): void;
    stop(): void;
    private onStart();
    private onDataAvailable(data);
    private onStop();
    private handleEncoderData(data);
    private handleEncoderFinish();
    private handleAudioProcess(ev);
}
