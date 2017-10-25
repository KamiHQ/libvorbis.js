/// <reference path="../typings/webrtc/MediaStream.d.ts" />
/// <reference path="../typings/webaudioapi/waa.d.ts" />
/// <reference path="../typings/es6-promise/es6-promise.d.ts" />
/// <reference path="MediaRecorder.d.ts" />
/// <reference path="vorbis_encoder.d.ts" />
var window;
if (window && !window.BlobEvent) {
    window.BlobEvent = function BlobEvent(type, init) {
        this.type = type;
        this.data = init.data;
    };
}
// END BlobEvent shim
var VorbisWorkerScript = (function () {
    function VorbisWorkerScript() {
    }
    VorbisWorkerScript.createWorker = function () {
        return new Worker(window.LIBVORBISJS_URL || VorbisWorkerScript.getCurrentScriptURL());
    };
    // NOTE `self` should be type `WorkerGlobalScope`
    // see https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope
    VorbisWorkerScript.main = function (self) {
        var Module = makeVorbisEncoderModule({
            onRuntimeInitialized: function () {
                self.postMessage({ type: 'load' });
            }
        });
        var handle;
        function flush() {
            var dataLength = Module._encoder_get_data_len(handle);
            if (dataLength === 0)
                return;
            var dataPointer = Module._encoder_get_data(handle);
            var chunk = Module.HEAPU8.subarray(dataPointer, dataPointer + dataLength);
            var data = new Uint8Array(chunk); // copy
            var buffer = data.buffer;
            Module._encoder_clear_data(handle);
            self.postMessage({ type: 'data', buffer: buffer }, [buffer]);
        }
        self.addEventListener('message', function (ev) {
            var data = ev.data;
            switch (data.type) {
                case 'start':
                    handle = Module._encoder_create_vbr(data.channels, data.sampleRate, data.quality);
                    Module._encoder_write_headers(handle);
                    flush();
                    break;
                case 'data':
                    Module._encoder_prepare_analysis_buffers(handle, data.samples);
                    for (var ch = 0; ch < data.channels; ++ch) {
                        var bufferPtr = Module._encoder_get_analysis_buffer(handle, ch);
                        var array = new Float32Array(data.buffers[ch]);
                        Module.HEAPF32.set(array, bufferPtr >> 2);
                    }
                    Module._encoder_encode(handle);
                    flush();
                    break;
                case 'finish':
                    Module._encoder_finish(handle);
                    flush();
                    Module._encoder_destroy(handle);
                    self.postMessage({ type: 'finish' });
                    break;
            }
        });
    };
    VorbisWorkerScript.getCurrentScriptURL = (function () {
        if (!this.document) {
            return null;
        }
        var script = document.currentScript;
        var scriptSrc = script.getAttribute('src');
        var absoluteRegex = /^(blob\:|http\:|https\:)/;
        var url;
        if (absoluteRegex.test(scriptSrc)) {
            url = scriptSrc;
        }
        else {
            var dirname = location.pathname.split('/').slice(0, -1).join('/');
            url = location.protocol + "//" + location.host;
            if (scriptSrc[0] === '/') {
                url += scriptSrc;
            }
            else {
                url += dirname + '/' + scriptSrc;
            }
        }
        return function () { return url; };
    })();
    return VorbisWorkerScript;
}());
function noop() { }
var VorbisEncoder = (function () {
    // ---
    function VorbisEncoder() {
        this._worker = VorbisWorkerScript.createWorker();
        // ---
        this._ondata = noop;
        this._onfinish = noop;
        // ---
        this._worker.onmessage = this.handleEncoderMessage.bind(this);
    }
    Object.defineProperty(VorbisEncoder.prototype, "ondata", {
        get: function () {
            return this._ondata;
        },
        set: function (value) {
            this._ondata = value || noop;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisEncoder.prototype, "onfinish", {
        get: function () {
            return this._onfinish;
        },
        set: function (value) {
            this._onfinish = value || noop;
        },
        enumerable: true,
        configurable: true
    });
    VorbisEncoder.prototype.init = function (channels, sampleRate, quality) {
        this._worker.postMessage({
            type: 'start',
            sampleRate: sampleRate,
            channels: channels,
            quality: quality
        });
    };
    VorbisEncoder.prototype.encode = function (buffers, samples, channels) {
        this._worker.postMessage({
            type: 'data',
            samples: samples,
            channels: channels,
            buffers: buffers
        }, buffers);
    };
    VorbisEncoder.prototype.finish = function () {
        this._worker.postMessage({ type: 'finish' });
    };
    VorbisEncoder.prototype.handleEncoderMessage = function (ev) {
        var data = ev.data;
        switch (data.type) {
            case 'load':
                // TODO
                break;
            case 'data':
                this._ondata(data.buffer);
                break;
            case 'finish':
                this._onfinish(new Event('finish'));
                break;
        }
    };
    return VorbisEncoder;
}());
var RecordingState;
(function (RecordingState) {
    RecordingState[RecordingState["inactive"] = 0] = "inactive";
    RecordingState[RecordingState["recording"] = 1] = "recording";
    RecordingState[RecordingState["paused"] = 2] = "paused";
})(RecordingState || (RecordingState = {}));
function makeBlobEvent(type, blob) {
    return new BlobEvent(type, { data: blob, blob: blob });
}
var VorbisMediaRecorder = (function () {
    // ---
    function VorbisMediaRecorder(stream, options) {
        this._state = RecordingState.inactive;
        this._stream = stream;
        this._encoder = new VorbisEncoder();
        this._chunks = [];
        this._ctx = new AudioContext();
        this._sourceNode = this._ctx.createMediaStreamSource(stream);
        this._procNode = this._ctx.createScriptProcessor(4096);
        this._onstart = noop;
        this._ondataavailable = noop;
        this._onstop = noop;
        // ---
        this._encoder.ondata = this.handleEncoderData.bind(this);
        this._encoder.onfinish = this.handleEncoderFinish.bind(this);
        this._procNode.onaudioprocess = this.handleAudioProcess.bind(this);
    }
    Object.defineProperty(VorbisMediaRecorder.prototype, "stream", {
        get: function () {
            return this._stream;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisMediaRecorder.prototype, "mimeType", {
        get: function () {
            return 'audio/ogg';
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisMediaRecorder.prototype, "state", {
        get: function () {
            return RecordingState[this._state];
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisMediaRecorder.prototype, "onstart", {
        get: function () {
            return this._onstart;
        },
        set: function (value) {
            this._onstart = value || noop;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisMediaRecorder.prototype, "ondataavailable", {
        get: function () {
            return this._ondataavailable;
        },
        set: function (value) {
            this._ondataavailable = value || noop;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(VorbisMediaRecorder.prototype, "onstop", {
        get: function () {
            return this._onstop;
        },
        set: function (value) {
            this._onstop = value || noop;
        },
        enumerable: true,
        configurable: true
    });
    VorbisMediaRecorder.prototype.start = function (timeslice) {
        var _this = this;
        if (timeslice !== undefined) {
            throw new Error('not implemented');
        }
        if (this._state !== RecordingState.inactive) {
            throw new Error('invalid state');
        }
        setTimeout(function () {
            _this._state = RecordingState.recording;
            _this._chunks = [];
            _this._sourceNode.connect(_this._procNode);
            _this._procNode.connect(_this._ctx.destination);
            var channels = _this._sourceNode.channelCount;
            var sampleRate = _this._ctx.sampleRate;
            _this._encoder.init(channels, sampleRate, 0.4);
            _this.onStart();
        });
    };
    VorbisMediaRecorder.prototype.stop = function () {
        var _this = this;
        if (this._state === RecordingState.inactive) {
            throw new Error('invalid state');
        }
        setTimeout(function () {
            _this._state = RecordingState.inactive;
            _this._sourceNode.disconnect(_this._procNode);
            _this._procNode.disconnect(_this._ctx.destination);
            _this._encoder.finish();
        });
    };
    VorbisMediaRecorder.prototype.onStart = function () {
        this._onstart(new Event('start'));
    };
    VorbisMediaRecorder.prototype.onDataAvailable = function (data) {
        this._ondataavailable(makeBlobEvent('dataavailable', data));
    };
    VorbisMediaRecorder.prototype.onStop = function () {
        this._onstop(new Event('stop'));
    };
    VorbisMediaRecorder.prototype.handleEncoderData = function (data) {
        this._chunks.push(data);
    };
    VorbisMediaRecorder.prototype.handleEncoderFinish = function () {
        var blob = new Blob(this._chunks, { type: this.mimeType });
        this.onDataAvailable(blob);
        this.onStop();
    };
    VorbisMediaRecorder.prototype.handleAudioProcess = function (ev) {
        var buffers = [];
        var audioBuffer = ev.inputBuffer;
        var samples = audioBuffer.length;
        var channels = audioBuffer.numberOfChannels;
        for (var ch = 0; ch < channels; ++ch) {
            // make a copy
            var array = audioBuffer.getChannelData(ch).slice();
            buffers.push(array.buffer);
        }
        this._encoder.encode(buffers, samples, channels);
    };
    return VorbisMediaRecorder;
}());
