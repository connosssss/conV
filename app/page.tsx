"use client";

import { useState, useRef, useCallback } from "react";

// ─── Audio Worklet Processor Code ────────────────────────────────────────────
// These strings are loaded as AudioWorklet modules via Blob URLs at runtime.

/** Captures raw PCM samples from the microphone and posts them to the main thread. */
const PCM_PROCESSOR_CODE = `
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

/** Receives Float32 PCM samples from the main thread and plays them back in order. */
const PLAYBACK_PROCESSOR_CODE = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this.port.onmessage = (e) => {
      const samples = e.data;
      for (let i = 0; i < samples.length; i++) {
        this._buffer.push(samples[i]);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    for (let i = 0; i < output.length; i++) {
      output[i] = this._buffer.length > 0 ? this._buffer.shift() : 0;
    }
    return true;
  }
}
registerProcessor("playback-processor", PlaybackProcessor);
`;

const MODEL = "gemini-3.1-flash-live-preview";
const WS_URL = (apiKey: string) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;


function workletBlobUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
}

function decodeAudioChunk(base64: string): Float32Array {
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

function float32ToBase64Pcm(float32: Float32Array): string {
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


export default function Home() {

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState<{ role: "user" | "model"; text: string }[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const appendTranscript = useCallback((role: "user" | "model", text: string) => {

    setTranscript((prev) => {
      const last = prev[prev.length - 1];

      if (last && last.role === role) {
        return [...prev.slice(0, -1), { role, text: last.text + text }];
      }


      return [...prev, { role, text }];
    });

  }, []);


  //plays audio chunk
  const playAudioChunk = useCallback((base64: string) => {
    playbackNodeRef.current?.port.postMessage(decodeAudioChunk(base64));

  }, []);



  // User mic setup
  const startMic = useCallback(async (ws: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      streamRef.current = stream;

      const micCtx = new AudioContext({ sampleRate: 16000 });
      await micCtx.audioWorklet.addModule(workletBlobUrl(PCM_PROCESSOR_CODE));

      const source = micCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(micCtx, "pcm-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: float32ToBase64Pcm(e.data as Float32Array), mimeType: "audio/pcm;rate=16000" },
            },
          })
        );
      };

      source.connect(workletNode);
      workletNode.connect(micCtx.destination);
      setStatus("Listening... Speak into your mic.");
    } catch (err) {
      setStatus("Mic error: " + (err as Error).message);
    }
  }, []);



// Program start
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!###########################################################################################################!!!!!!!!!!!!

  const start = useCallback(async () => {
    setTranscript([]);
    setStatus("fetching api key");

    const res = await fetch("/api/gemini-live");
    const { apiKey } = await res.json();


    if (!apiKey) { 

      setStatus("no api key"); 
      return; 
    }

    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioCtx;
    await audioCtx.audioWorklet.addModule(workletBlobUrl(PLAYBACK_PROCESSOR_CODE));


    const playbackNode = new AudioWorkletNode(audioCtx, "playback-processor");
    playbackNode.connect(audioCtx.destination);
    playbackNodeRef.current = playbackNode;
    setStatus("connecting to live");


    const ws = new WebSocket(WS_URL(apiKey));

    wsRef.current = ws;


    // WEBSOCKETS
    ws.onopen = () => {
      setStatus("Connected. Sending config...");
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${MODEL}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
        })
      );
    };


    
    ws.onmessage = async (event) => {
      const text = event.data instanceof Blob ? await event.data.text() : event.data;
      const msg = JSON.parse(text);

      if (msg.setupComplete) {
        setStatus("Setup complete. Starting mic...");
        startMic(ws);
        return;
      }

      const sc = msg.serverContent;

      if (!sc) return;


      // Plays models audio
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) playAudioChunk(part.inlineData.data);
      }

      if (sc.outputTranscription?.text) appendTranscript("model", sc.outputTranscription.text);
      if (sc.inputTranscription?.text) appendTranscript("user", sc.inputTranscription.text);
    };

    ws.onerror = () => setStatus("WebSocket error");
    ws.onclose = () => { setStatus("Disconnected"); setRunning(false); };

    setRunning(true);


  }, [playAudioChunk, startMic, appendTranscript]);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    setRunning(false);
    setStatus("stopped");
  }, []);


  return (
    <div>
      <button onClick={running ? stop : start}>{running ? "Stop" : "Start"}</button>
      <p>{status}</p>
      <hr />
      <div>
        {transcript.map((entry, i) => (
          <p key={i}>
            <div>{entry.role === "user" ? "You" : "Gemini"}:</div> {entry.text}
          </p>
        ))}
      </div>
    </div>
  );
}
