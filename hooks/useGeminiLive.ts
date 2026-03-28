import { useState, useRef, useCallback } from "react";
import {
  PCM_PROCESSOR_CODE,
  PLAYBACK_PROCESSOR_CODE,
  workletBlobUrl,
  decodeAudioChunk,
  float32ToBase64Pcm,
} from "../lib/audio";

const MODEL = "gemini-3.1-flash-live-preview";
const WS_URL = (apiKey: string) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

interface UseGeminiLiveOptions {
  language: string;
  inputScenario: string;
  additionalInstructions: string;
}

export function useGeminiLive({
  language,
  inputScenario,
  additionalInstructions,
}: UseGeminiLiveOptions) {
  const [running, setRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState<{ role: "user" | "model"; text: string }[]>([]);
  const [canSpeak, setCanSpeak] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const canSpeakRef = useRef(false);
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  const appendTranscript = useCallback((role: "user" | "model", text: string) => {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        return [...prev.slice(0, -1), { role, text: last.text + text }];
      }
      return [...prev, { role, text }];
    });
  }, []);

  const playAudioChunk = useCallback((base64: string) => {
    const float32Data = decodeAudioChunk(base64);
    playbackNodeRef.current?.port.postMessage(float32Data, [float32Data.buffer]);
  }, []);

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
        if (!canSpeakRef.current) return;

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

  const start = useCallback(async () => {
    if (isConnecting || running) return;
    setIsConnecting(true);
    setTranscript([]);
    setStatus("fetching api key");

    const res = await fetch("/api/gemini-live");
    const { apiKey } = await res.json();

    if (!apiKey) {
      setStatus("no api key");
      setIsConnecting(false);
      return;
    }

    setStatus("Generating system instructions...");
    let generatedInstruction = `The user input will be in ${language || "any language"}, try to respond in that as well.
     Your main task will to be have a conversation in the language if specified and you want to follow this specific scenario: ${inputScenario}. 
    You will follow this scenario as if you are a person in it.`;
    let generatedLangCode = "en-US";

    try {
      console.log("LANGUAGE: " + language + " INPUT SCENARIO: " + inputScenario);
      const gRes = await fetch("/api/generate-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, scenario: inputScenario, extraInstructions: additionalInstructions }),
      });

      const parsed = await gRes.json();
      if (parsed.systemInstruction) {
        generatedInstruction = parsed.systemInstruction;
        console.log(generatedInstruction);
      }
      if (parsed.languageCode) generatedLangCode = parsed.languageCode;
    } catch (err) {
      console.error("Error generating system instruction:", err);
      setStatus("Error generating instructions. Using defaults.");
    }

    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioCtx;
    await audioCtx.audioWorklet.addModule(workletBlobUrl(PLAYBACK_PROCESSOR_CODE));

    const playbackNode = new AudioWorkletNode(audioCtx, "playback-processor");
    playbackNode.connect(audioCtx.destination);
    playbackNodeRef.current = playbackNode;

    playbackNode.port.onmessage = (e) => {
      const { playing } = e.data;
      console.log("Playbacknodethingy");

      if (playing) {
        if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
        canSpeakRef.current = false;
        setCanSpeak(false);
      } else {
        playbackTimerRef.current = setTimeout(() => {
          canSpeakRef.current = true;
          setCanSpeak(true);
        }, 500);
      }
    };

    setStatus("connecting to live");

    const ws = new WebSocket(WS_URL(apiKey));
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("Connected. Sending config...");

      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${MODEL}`,
            systemInstruction: {
              parts: [{ text: generatedInstruction }]
            },
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                languageCode: generatedLangCode
              }
            },
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
        setStatus("starting mic");
        canSpeakRef.current = false;
        setCanSpeak(false);

        ws.send(
          JSON.stringify({
            realtimeInput: {text: "Please begin the scenario."}
          })
        );

        startMic(ws);
        return;
      }

      const sc = msg.serverContent;
      if (!sc) return;

      if (sc.interrupted) {
        playbackNodeRef.current?.port.postMessage({ command: "clear" });
      }

      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) playAudioChunk(part.inlineData.data);
      }

      if (sc.outputTranscription?.text) appendTranscript("model", sc.outputTranscription.text);
      if (sc.inputTranscription?.text) appendTranscript("user", sc.inputTranscription.text);
    };

    ws.onerror = () => { setStatus("WebSocket error"); setIsConnecting(false); };
    ws.onclose = () => { setStatus("Disconnected"); setRunning(false); setIsConnecting(false); };

    setRunning(true);
    setIsConnecting(false);

  }, [playAudioChunk, startMic, appendTranscript, language, inputScenario, additionalInstructions, isConnecting, running]);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    canSpeakRef.current = false;
    setCanSpeak(false);

    setRunning(false);
    setStatus("stopped");
  }, []);

  return {
    running,
    isConnecting,
    status,
    transcript,
    canSpeak,
    start,
    stop,
  };
}
