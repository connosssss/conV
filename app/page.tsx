"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGeminiLive } from "../hooks/useGeminiLive";
import { jsPDF } from "jspdf";

export default function Home() {
  const [language, setLanguage] = useState("");
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  const [showAppInfoPopup, setShowAppInfoPopup] = useState(false);
  const [inputScenario, setInputScenario] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{report: string; score: string; workOn?: string[]; doneWell?: string[]} | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

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

  const handleStart = () => {
    setShowSummary(false);
    setSummaryData(null);
    start();
  };

  const handleEndSession = async () => {
    stop();
    if (transcript.length === 0) {
      return;
    }
    
    setShowSummary(true);
    setIsLoadingSummary(true);

    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      setSummaryData(data);
    } 
    
    catch (err) {
      console.error("Failed to generate summary", err);
      setSummaryData({ report: "Could not generate summary.", score: "Error" });
    } 
    
    finally {
      setIsLoadingSummary(false);
    }
  };

  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    let yPos = 20;
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const textWidth = pageWidth - margin * 2;
    const pageHeight = doc.internal.pageSize.getHeight();

    const addText = (text: string, size: number, isBold: boolean = false, color: number[] = [0, 0, 0]) => {
      doc.setFontSize(size);
      if (isBold) {
        doc.setFont("helvetica", "bold");
      } else {
        doc.setFont("helvetica", "normal");
      }
      doc.setTextColor(color[0], color[1], color[2]);
      
      const lines = doc.splitTextToSize(text, textWidth);
      for (let i = 0; i < lines.length; i++) {
        if (yPos > pageHeight - margin) {
          doc.addPage();
          yPos = margin + 10;
        }
        doc.text(lines[i], margin, yPos);
        yPos += size * 0.4;
      }
      yPos += size * 0.2;
    };

    addText("Conversation Report", 24, true, [107, 35, 35]);
    yPos += 5;

    if (summaryData) {
      if (summaryData.score) {
        addText(`Score: ${summaryData.score}`, 18, true, [135, 58, 58]);
        yPos += 5;
      }
      if (summaryData.report) {
        addText(summaryData.report, 12);
        yPos += 5;
      }
      
      if (summaryData.doneWell && summaryData.doneWell.length > 0) {
        addText("Done Well:", 14, true, [46, 138, 72]);
        summaryData.doneWell.forEach(item => {
          addText(`• ${item}`, 12);
        });
        yPos += 5;
      }

      if (summaryData.workOn && summaryData.workOn.length > 0) {
        addText("Things to work on:", 14, true, [138, 36, 36]);
        summaryData.workOn.forEach(item => {
          addText(`• ${item}`, 12);
        });
        yPos += 5;
      }
    }

    yPos += 10;
    addText("Transcript", 20, true);
    yPos += 5;

    transcript.forEach(entry => {
      const isUser = entry.role === "user";
      const roleLabel = isUser ? "You" : "AI";
      const color = isUser ? [80, 80, 80] : [0, 0, 0];
      
      addText(`${roleLabel}:`, 12, true, color);
      addText(entry.text, 12, false, color);
      yPos += 2;
    });

    doc.save("Chiika_Conversation_Report.pdf");
  };

  return (
    <div className="bg-gradient-to-b from-[#873A3A] to-[#732727] overflow-hidden overflow-y-hidden h-screen w-full flex flex-col items-center relative rounded-md font-sans text-black/70">
      <AnimatePresence mode="wait">
        {!running && !showSummary ? (
          <motion.div
            key="setup-ui"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, filter: "blur(5px)" }}
            transition={{ duration: 0.5 }}
            className="w-full flex h-full flex-col items-center gap-8 mt-20 z-10"
          >
            <div className="w-full flex flex-col items-center gap-2">
            <h1 className="text-5xl font-semibold tracking-[0.5rem] text-white/80 z-20 flex-shrink-0  ">
              chiika
            </h1>
            <div className="flex items-center gap-2 mb-10 z-20 flex-shrink-0">
              <h3 className="text-xl font-semibold tracking-wide text-white/70">
                real-time, personalized, language learning conversation
              </h3>
              <button
                onClick={() => setShowAppInfoPopup(true)}
                className="text-white/70 hover:text-white transition-colors cursor-pointer"
                aria-label="App information"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </button>
            </div>
            </div>
            <div className="w-full flex flex-col items-center gap-1">
              <label className="text-white/80 text-lg tracking-wide">target language</label>
              <textarea
                id="language-input"
                value={language}
                onChange={(e) => {
                  const val = e.target.value;
                  setLanguage(val);
                  console.log("LANGUAGE: " + val);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isConnecting) handleStart();
                  }
                }}
                disabled={running}
                className="bg-[#D9D9D9]/90 w-3/8 min-h-[32px] rounded-md px-3 py-1 text-center resize-none focus:outline-none overflow-hidden block"
                placeholder="Spanish"
                rows={1}
                style={{ height: "32px" }}
              />
            </div>

            <div className="w-full flex flex-col items-center gap-1">
              <label className="text-white/80 text-lg tracking-wide">conversation scenario</label>
              <textarea
                value={inputScenario}
                onChange={(e) => {
                  const val = e.target.value;
                  setInputScenario(val);
                  console.log("INPUT SCENARIO: " + val);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isConnecting) handleStart();
                  }
                }}
                disabled={running}
                className="bg-[#D9D9D9]/85 w-3/8 min-h-[32px] rounded-md px-3 py-1 text-center resize-none focus:outline-none overflow-hidden block"
                placeholder="Ordering a coffee at a cafe"
                rows={1}
                style={{ height: "32px" }}
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
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="text-white/70">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                </button>
              </div>
              <textarea
                value={additionalInstructions}
                onChange={(e) => {
                  const val = e.target.value;
                  setAdditionalInstructions(val);
                  console.log("ADDITIONAL INSTRUCTIONS: " + val);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isConnecting) handleStart();
                  }
                }}
                disabled={running}
                className="bg-[#D9D9D9]/85 w-3/8 min-h-[32px] rounded-md px-3 py-1 text-center resize-none focus:outline-none overflow-hidden block"
                placeholder="Correct my Spanish grammar in English"
                rows={1}
                style={{ height: "32px" }}
              />
            </div>

            <button
              onClick={handleStart}
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
              
              <AnimatePresence>
                {showSummary && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full flex justify-center mt-4 mb-8"
                  >
                    <div className="w-full p-6 rounded-md backdrop-blur-md shadow-lg bg-[#D9D9D9]/90 text-black border border-white/20 flex flex-col items-center gap-4">
                      {isLoadingSummary ? (
                        <p className="text-lg font-medium text-center">Generating conversation summary...</p>
                      ) : (
                        <>
                          <h2 className="text-xl font-semibold tracking-wide text-[#6B2323]">conversation report</h2>
                          <div className="text-3xl font-semibold text-[#873A3A] mb-2 tracking-tighter">{summaryData?.score}</div>
                          <p className="text-lg text-center leading-relaxed ">{summaryData?.report}</p>



                          {((summaryData?.workOn && summaryData.workOn.length > 0) || (summaryData?.doneWell && summaryData.doneWell.length > 0)) && (
                            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mt-2 mb-2">
                              {summaryData?.doneWell && summaryData.doneWell.length > 0 && (
                                <div className="p-5 flex flex-col gap-3">
                                  <h3 className="font-bold text-[#2e8a48] tracking-wider text-sm flex items-center gap-2">
                                    done well!
                                  </h3>
                                  <ul className="list-disc pl-5 text-sm text-[#1b5e2f] space-y-1.5  border-l-2 border-[#1b5e2f]">
                                    {summaryData.doneWell.map((item, idx) => (
                                      <li key={idx} className="font-medium">{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              
                              {summaryData?.workOn && summaryData.workOn.length > 0 && (
                                <div className="b p-5 flex flex-col gap-3">
                                  <h3 className="font-bold text-[#8a2424] tracking-wider text-sm flex items-center gap-2">
                                    things to work on...
                                  </h3>
                                  <ul className="list-disc pl-5 text-sm text-[#731818] space-y-1.5 border-l-2 border-[#731818]">
                                    {summaryData.workOn.map((item, idx) => (
                                      <li key={idx} className="font-medium">{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}


                          {/*bg-[#6B2323]/65 hover:bg-[#873A3A]/65 */}

                          <div className="flex flex-col gap-3 mt-4 w-1/3">
                            <button
                              onClick={handleExportPDF}
                              className="px-3 py-2 bg-black/35 hover:bg-black/25 text-white rounded-md shadow-md  transition font-bold tracking-wider"
                            >
                              Export as PDF
                            </button>
                            <button
                              onClick={() => {
                                  setShowSummary(false);
                              }}
                              className="px-3 py-2 bg-[#6B2323] text-white rounded-md shadow-md hover:bg-[#873A3A] transition font-semibold tracking-wider"
                            >
                              Return to Menu
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={endOfMessagesRef} />
            </div>

            {(!showSummary) && (
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
                  onClick={handleEndSession}
                  className="bg-[#9e4242] hover:bg-[#c15f5f] text-white transition-all py-2 px-8 rounded-md tracking-wider shadow-md active:scale-95"
                >
                  End Session
                </button>
              </motion.div>
            )}

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
              <div className="text-black/70 leading-relaxed text-sm flex flex-col gap-3 w-full">
                <p className="text-center">
                  Here you can add anything that you want to be in the conversation. For example you can do things like:
                </p>
                <ul className="list-disc pl-5 space-y-1 mx-auto text-left w-3/4">
                  <li>ask it to give you a rating when you request it</li>
                  <li>fix your grammar when you mess up</li>
                  <li>give translations after each statement</li>
                </ul>
                <p className="text-center mt-1">
                  there is really no limit, so don't be afraid to specify anything!
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAppInfoPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowAppInfoPopup(false)}
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
                onClick={() => setShowAppInfoPopup(false)}
                className="absolute top-3 right-3 text-black/50 hover:text-black transition-colors"
                aria-label="Close popup"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <h3 className="text-xl font-semibold mb-3 text-black/80 tracking-wide text-center">About Chiika</h3>
              <div className="text-black/70 leading-relaxed text-sm flex flex-col gap-3 w-full text-center">
                <p>
                  Chiika is an interactive platform built to help you learn languages through immersive conversation.
                </p>
                <p>
                  Simply provide a scenario, a language, and any extra instructions, and you'll jump straight into a live audio chat with an AI designed to naturally converse and help you improve!
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
