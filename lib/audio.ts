export const PCM_PROCESSOR_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`;

export const PLAYBACK_PROCESSOR_CODE = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    this.bufferQueue = [];
    this.currentBuffer = null;
    this.currentPtr = 0;
    this.isPlaying = false;
  }

  handleMessage(e) {
    if (e.data && e.data.command === "clear") {
      this.bufferQueue = [];
      this.currentBuffer = null;
      this.currentPtr = 0;
      return;
    }
    this.bufferQueue.push(e.data);
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    let outPtr = 0;
    
    while (outPtr < output.length) {
      if (!this.currentBuffer) {
        if (this.bufferQueue.length > 0) {
          this.currentBuffer = this.bufferQueue.shift();
          this.currentPtr = 0;
        } else {
          break;
        }
      }

      const available = this.currentBuffer.length - this.currentPtr;
      const needed = output.length - outPtr;

      if (available >= needed) {
        output.set(this.currentBuffer.subarray(this.currentPtr, this.currentPtr + needed), outPtr);
        this.currentPtr += needed;
        outPtr += needed;
        if (this.currentPtr >= this.currentBuffer.length) {
          this.currentBuffer = null;
        }
      } else {
        output.set(this.currentBuffer.subarray(this.currentPtr), outPtr);
        outPtr += available;
        this.currentBuffer = null;
      }
    }

    if (outPtr < output.length) {
      for (let i = outPtr; i < output.length; i++) {
        output[i] = 0;
      }
    }

    const isActuallyPlaying = !!this.currentBuffer || this.bufferQueue.length > 0;
    if (isActuallyPlaying !== this.isPlaying) {
      this.isPlaying = isActuallyPlaying;
      this.port.postMessage({ playing: this.isPlaying });
    }

    return true;
  }
}
registerProcessor("playback-processor", PlaybackProcessor);
`;

export function workletBlobUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
}

export function decodeAudioChunk(base64: string): Float32Array {
  const raw = atob(base64);

  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }

  return samples;
}

export function float32ToBase64Pcm(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
