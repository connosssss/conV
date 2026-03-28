"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";


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

const PLAYBACK_PROCESSOR_CODE = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    this.bufferQueue = [];
    this.currentBuffer = null;
    this.currentPtr = 0;
    this.isPlaying = false;
    this.isBuffering = true;
  }

  handleMessage(e) {
    this.bufferQueue.push(e.data);
  }

  getTotalBuffered() {
    let total = 0;
    if (this.currentBuffer) {
      total += this.currentBuffer.length - this.currentPtr;
    }
    for (const buf of this.bufferQueue) {
      total += buf.length;
    }
    return total;
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    
    const totalBuffered = this.getTotalBuffered();
    
    if (this.isBuffering) {
      if (totalBuffered >= 2400) {
        this.isBuffering = false;
      } else {
        // Output silence while buffering
        for (let i = 0; i < output.length; i++) {
          output[i] = 0;
        }
        return true;
      }
    }

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
      this.isBuffering = true; // Wait for buffer to recover next time
    }

    const hasAudio = totalBuffered > 0;
    if (hasAudio !== this.isPlaying) {
      this.isPlaying = hasAudio;
      this.port.postMessage({ playing: this.isPlaying });
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

  const [language, setLanguage] = useState("");
  const [canSpeak, setCanSpeak] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const canSpeakRef = useRef(false);
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const [inputScenario, setInputScenario] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");



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
    const float32Data = decodeAudioChunk(base64);
    playbackNodeRef.current?.port.postMessage(float32Data, [float32Data.buffer]);
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
    // GET GENERATED INSTRUCTIONS
    setStatus("Generating system instructions...");
    //default
    let generatedInstruction = `The user input will be in ${language || "any language"}, try to respond in that as well.
     Your main task will to be have a conversation in the language if specified and you want to follow this specific scenario: ${inputScenario}. 
    You will follow this scenario as if you are a person in it.`;
    let generatedLangCode = "en-US";

    try {
      console.log("LANGUAGE: " + language + " INPUT SCENARIO: " + inputScenario)
      const gRes = await fetch("/api/generate-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, scenario: inputScenario, extraInstructions: additionalInstructions }),
      });

      
      const parsed = await gRes.json();
      if (parsed.systemInstruction) {
        generatedInstruction = parsed.systemInstruction;
        console.log(generatedInstruction)
    }
      if (parsed.languageCode) generatedLangCode = parsed.languageCode;

    } 
    
    catch (err) {
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
      console.log("Playbacknodethingy")

      if (playing) {
        if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
        canSpeakRef.current = false;
        setCanSpeak(false);

      }

      else {
        playbackTimerRef.current = setTimeout(() => {
          canSpeakRef.current = true;
          setCanSpeak(true);

        }, 500);
      }
    };

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
            realtimeInput: {
              text: "Please begin the scenario.",
            },
          })
        );

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


  }, [playAudioChunk, startMic, appendTranscript, language, inputScenario, additionalInstructions]);

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


  return (
    <div className="bg-gradient-to-b from-[#873A3A] to-[#6B2323] overflow-hidden overflow-y-hidden h-screen w-full flex flex-col items-center relative rounded-md font-sans text-black/70">
      <motion.h1 
        initial={{ y: 0, scale: 1 }}
        animate={{ y: running ? -30 : 0, scale: running ? 0.7 : 1, opacity: running ? 0.7 : 1 }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
        className="text-5xl font-semibold tracking-[0.5rem] text-white/80 mt-20 z-20 flex-shrink-0"
      >
        chiika
      </motion.h1>

      <AnimatePresence mode="wait">
        {!running ? (
          <motion.div 
            key="setup-ui"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, filter: "blur(5px)" }}
            transition={{ duration: 0.5 }}
            className="w-full flex h-full flex-col items-center gap-8 mt-20 z-10"
          >
            <div className="w-full flex flex-col items-center gap-1">
              <label className="text-white/80 text-lg tracking-wide">language</label>
              <input
                type="text"
                id="language-input"
                value={language}
                onChange={(e) => {
                  const val = e.target.value;
                  setLanguage(val);
                  console.log("LANGUAGE: " + val);
                }}
                disabled={running}
                className="bg-[#D9D9D9] w-3/8 h-8 rounded-md px-3 text-center"
                placeholder="Spanish"
              />
            </div>

            <div className="w-full flex flex-col items-center gap-1">
              <label className="text-white/80 text-lg tracking-wide">scenario</label>
              <input 
                type="text" 
                value={inputScenario} 
                onChange={(e) => {
                  const val = e.target.value;
                  setInputScenario(val);
                  console.log("INPUT SCENARIO: " + val);
                }}
                className="bg-[#D9D9D9] w-3/8 h-8 rounded-md px-3 text-center" 
                placeholder="Ordering a coffee at a cafe"
              />
            </div>
            
            <div className="w-full flex flex-col items-center gap-1">
              <label className="text-white/80 text-lg tracking-wide"> additional instructions (optional)</label>
              <input 
                type="text" 
                value={additionalInstructions} 
                onChange={(e) => {
                  const val = e.target.value;
                  setAdditionalInstructions(val);
                  console.log("ADDITIONAL INSTRUCTIONS: " + val);
                }}
                className="bg-[#D9D9D9] w-3/8 h-8 rounded-md px-3 text-center" 
                placeholder="Correct my Spanish grammar in English"
              />
            </div>

            <button 
              onClick={start}
              className="bg-[#D9D9D9] hover:bg-[#A3A3A3] transition-all duration-200 py-1 px-3 rounded-md w-1/4 active:scale-95"
            >
              Start
            </button>
          </motion.div>
        ) : (

          <motion.div 
            key="active-ui"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="w-full max-w-4xl flex-1 flex flex-col relative z-10 px-4 min-h-0"
          >
            
            <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar pb-32 pt-4 flex flex-col gap-6 scroll-smooth pr-2">
              {transcript.map((entry, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
                  className={`flex w-full ${entry.role === "user" ? "justify-end" : "justify-start"}`}
                >

                  <div className={`max-w-[85%] p-5 rounded-3xl backdrop-blur-md shadow-lg ${
                    entry.role === "user" 
                      ? "bg-white/20 text-white rounded-br-sm border border-white/20" 
                      : "bg-black/20 text-white/90 rounded-bl-sm border border-black/10"
                  }`}>

                    <p className="text-xs uppercase tracking-widest opacity-60 mb-2 font-medium">
                      {entry.role === "user" ? "You" : "AI"}
                    </p>

                    <p className="text-xl leading-relaxed whitespace-pre-wrap">{entry.text}</p>
                  </div>
                </motion.div>
              ))}
              <div ref={endOfMessagesRef} />
            </div>

            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="absolute bottom-6 left-0 w-full flex flex-col items-center gap-4"
            >

              <div className="flex items-center gap-3 bg-black/30 backdrop-blur-xl py-2 px-6 rounded-md border border-white/10 shadow-2xl">
                <div className={`w-3 h-3 rounded-full transition-all duration-300 ${!running ? "bg-gray-400" : canSpeak ? "bg-green-400 shadow-[0_0_12px_rgba(74,222,128,0.6)]" : "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.6)]"}`}></div>
                <p className="text-white/80 text-sm tracking-wide font-medium">{canSpeak? "Listening..." : "Speaking..."}</p>
              </div>

              <button 
                onClick={stop} 
                className="bg-red-500/80 hover:bg-red-500 text-white transition-all py-2 px-8 rounded-md tracking-wider shadow-md active:scale-95"
              >

                End Session
              </button>

            </motion.div>
          </motion.div>
        )}

      </AnimatePresence>



      <AnimatePresence>
        {running && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_80%)] pointer-events-none z-0"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
