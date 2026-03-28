"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGeminiLive } from "../hooks/useGeminiLive";

export default function Home() {
  const [language, setLanguage] = useState("");
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  const [inputScenario, setInputScenario] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  const {
    running,
    isConnecting,
    status,
    transcript,
    canSpeak,
    start,
    stop,
  } = useGeminiLive({
    language,
    inputScenario,
    additionalInstructions,
  });

  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  return (
    <div className="bg-gradient-to-b from-[#873A3A] to-[#6B2323] overflow-hidden overflow-y-hidden h-screen w-full flex flex-col items-center relative rounded-md font-sans text-black/70">
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
            <h1 className="text-5xl font-semibold tracking-[0.5rem] text-white/80 z-20 flex-shrink-0 mb-2">
              chiika
            </h1>
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
                className="bg-[#D9D9D9]/90 w-3/8 h-8 rounded-md px-3 text-center"
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
                className="bg-[#D9D9D9]/85 w-3/8 h-8 rounded-md px-3 text-center"
                placeholder="Ordering a coffee at a cafe"
              />
            </div>

            <div className="w-full flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                <label className="text-white/80 text-lg tracking-wide"> additional instructions (optional)</label>
                <button
                  onClick={() => setShowInfoPopup(true)}
                  className="text-white/80 hover:text-white transition-colors cursor-pointer"
                  aria-label="More information"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </button>
              </div>
              <input
                type="text"
                value={additionalInstructions}
                onChange={(e) => {
                  const val = e.target.value;
                  setAdditionalInstructions(val);
                  console.log("ADDITIONAL INSTRUCTIONS: " + val);
                }}
                className="bg-[#D9D9D9]/85 w-3/8 h-8 rounded-md px-3 text-center"
                placeholder="Correct my Spanish grammar in English"
              />
            </div>

            <button
              onClick={start}
              disabled={isConnecting}
              className="bg-[#D9D9D9]/85 hover:bg-[#D9D9D9] transition-all duration-200 py-1 px-3 rounded-md w-1/4 active:scale-95 disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Start"}
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
                  <div className={`max-w-[85%] p-5 rounded-3xl backdrop-blur-md shadow-lg ${entry.role === "user"
                    ? "bg-[#D9D9D9]/50 text-white rounded-br-sm border border-white/20"
                    : "bg-black/50 text-white/90 rounded-bl-sm border border-black/10"
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
                <div className={`w-3 h-3 rounded-full transition-all duration-300 ${!running ? "bg-gray-400" : canSpeak ? "bg-[#4bd472]" : "bg-[#cf4d4d]"}`}></div>
                <p className="text-white/80 text-sm tracking-wide font-medium">{canSpeak ? "Listening..." : "Speaking..."}</p>
              </div>
              <button
                onClick={stop}
                className="bg-[#9e4242] hover:bg-[#c15f5f] text-white transition-all py-2 px-8 rounded-md tracking-wider shadow-md active:scale-95"
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

      <AnimatePresence>
        {showInfoPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowInfoPopup(false)}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ delay: 0.1, duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#D9D9D9] p-6 rounded-lg max-w-sm w-full shadow-2xl relative cursor-default"
            >
              <button
                onClick={() => setShowInfoPopup(false)}
                className="absolute top-3 right-3 text-black/50 hover:text-black transition-colors"
                aria-label="Close popup"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <h3 className="text-xl font-semibold mb-3 text-black/80 tracking-wide text-center">Additional Instructions</h3>
              <p className="text-black/70 leading-relaxed text-sm text-center">
                Here you can add anything that you want to be in the conversation. For example you can do things like ask it to give you a rating when you request it,
                fix your grammar when you mess up, or give translations after each statement; there is really no limit, so don't be afraid to specify anything!
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
