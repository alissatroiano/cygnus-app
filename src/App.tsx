import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import Logo from './Logo';
import {
  ShieldAlert,
  Globe,
  Mic,
  MicOff,
  Monitor,
  Activity,
  ExternalLink,
  ChevronRight,
  Info,
  MousePointer2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface UIAction {
  type: string;
  detail: string;
  timestamp: string;
}

// --- Constants ---
const CYGNUS_SYSTEM_INSTRUCTION = `
You are Cygnus, a real-time UI Navigator. 

1. MONITOR: Watch user's browser and monitor for any activity that relates to searching for flights, including research, or booking. Look for country names, airport codes, and flight booking websites, including Google Flights, Kayak, Expedia, etc.
2. DOMESTIC: If the user is looking at domestic flights (within the US), state: "I am an international travel advisor, so I don't think you need my help. Enjoy your travels!"
3. TALK: When an international destination is detected, immediately speak to the user. Say, "I noticed you're looking at international flights to [Destination]. Did you know most flights canceled due to passport issues are simply caused by lack of awareness of entry requirements?" 
4. OFFER HELP: Ask: "Would you like to check the specific entry requirements for your destination?"
5. ACTION: If the user says yes, provide the information about the [Destination] they are planning to visit. Use the 'update_destination_info' tool to display the key requirements (Passport Validity, Blank Pages, Visa) in the UI Navigator window. Ask them if they want you to read the information or if they'd like to see more details.
6. ACTION: If the user interrupts and/or says they only need to know a single thing, respond ONLY with the information they need and update the UI accordingly. If the user interrupts and/or asks if they can look up their passport information, tell them that there is no public database of US passports, so they have to check theirs physically. If the user interrupts and/or states that they are visiting more than one destination, ask if they want YOU to look it up. 
7. ACTION: If the user says they want to look this up on their own, use the 'open_url' tool to open the destination-specific advisory link: https://travel.state.gov/en/international-travel/travel-advisories/[DESTINATION].html. If no specific destination is confirmed, use https://travel.state.gov/en/international-travel.html.


CLARIFICATION: You are Cygnus, an international flight companion. You guide the user primarily through voice and screen sharing. You display helpful information in the UI Navigator/Stream window for them AND/OR open helpful URLs for them if they verbally agree.
`;

// --- Components ---

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<'idle' | 'monitoring' | 'assisting'>('idle');
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [showCursor, setShowCursor] = useState(false);
  const [userIntent, setUserIntent] = useState("");
  const [actionHistory, setActionHistory] = useState<UIAction[]>([]);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [destinationInfo, setDestinationInfo] = useState<{
    country: string;
    passportValidity: string;
    blankPages: string;
    visaRequired: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const addDebugLog = (msg: string) => {
    console.log(`[DEBUG] ${msg}`);
    setDebugLogs(prev => [`${new Date().toLocaleTimeString()}: ${msg}`, ...prev].slice(0, 5));
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isRecordingRef = useRef(false);

  const addAction = (type: string, detail: string) => {
    setActionHistory(prev => [{
      type,
      detail,
      timestamp: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 10));
  };

  const moveCursor = async (x: number, y: number) => {
    setShowCursor(true);
    setCursorPos({ x, y });
    await new Promise(resolve => setTimeout(resolve, 800));
    // Brief "click" effect
    setCursorPos(prev => ({ ...prev }));
    await new Promise(resolve => setTimeout(resolve, 200));
  };

  // Initialize Audio Context on first user interaction
  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }
  };

  const startMonitoring = async () => {
    initAudio();
    setError(null);
    nextStartTimeRef.current = 0;
    addDebugLog("Starting monitoring...");
    try {
      // 1. Capture Screen
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false
      }).catch(err => {
        addDebugLog(`Screen capture failed: ${err.name}`);
        if (err.name === 'NotAllowedError') {
          throw new Error("Screen sharing permission was denied. Please allow screen access to use Cygnus.");
        }
        throw err;
      });

      // 2. Capture Mic
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(err => {
        addDebugLog(`Mic capture failed: ${err.name}`);
        if (err.name === 'NotAllowedError') {
          throw new Error("Microphone permission was denied. Please allow microphone access to use Cygnus.");
        }
        throw err;
      });

      streamRef.current = screenStream;
      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
      }

      setIsActive(true);
      setIsRecording(true);
      isRecordingRef.current = true;
      setStatus('monitoring');
      
      const BACKEND_URL = process.env.VITE_BACKEND_URL;
      if (BACKEND_URL) {
        addDebugLog(`Connecting to backend: ${BACKEND_URL}`);
        const wsUrl = BACKEND_URL.replace('http', 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        setSocket(ws);
        
        ws.onopen = () => {
          addDebugLog("Backend Connected!");
          // Create a compatible session object for startStreaming
          const session = {
            sendRealtimeInput: (params: any) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ realtimeInput: params.media }));
              }
            }
          };
          sessionRef.current = session;
          startStreaming(session, micStream);
        };
        
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
            playAudio(msg.serverContent.modelTurn.parts[0].inlineData.data);
          }
          if (msg.serverContent?.modelTurn?.parts[0]?.text) {
            const text = msg.serverContent.modelTurn.parts[0].text;
            setTranscript(prev => [...prev, `Navigator: ${text}`].slice(-5));
          }
          if (msg.toolCall) {
            msg.toolCall.functionCalls.forEach((call: any) => {
              addDebugLog(`Backend Tool: ${call.name}`);
              if (call.name === 'navigate_to_url') {
                addAction("Navigate", `Browser navigating to ${call.args.url}`);
              } else if (call.name === 'scroll_window') {
                addAction("Scroll", `Scrolling page ${call.args.direction}`);
              } else if (call.name === 'click_element') {
                addAction("Click", `Interaction: ${call.args.description || 'UI Element'}`);
              } else if (call.name === 'type_text') {
                addAction("Type", `Entering data: ${call.args.element_description || 'Text Field'}`);
              }
            });
          }
        };
        
        ws.onclose = () => {
          addDebugLog("Backend Closed");
          stopMonitoring();
        };
        
        ws.onerror = () => {
          addDebugLog("Backend Error");
          setError("Connection to backend failed.");
        };
        
        return; // Important: exit startMonitoring here
      }

      // 3. Connect to Gemini Live (Original Direct Path)
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        addDebugLog("API Key is missing!");
        setError("Gemini API Key is missing. Please ensure it is set in the environment.");
        stopMonitoring();
        return;
      }

      addDebugLog("Connecting to Gemini Live...");
      const ai = new GoogleGenAI({ apiKey });

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: CYGNUS_SYSTEM_INSTRUCTION,
          tools: [
            { googleSearch: {} },
            {
              functionDeclarations: [
                {
                  name: "update_destination_info",
                  description: "Updates the UI with specific travel requirements for a destination.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      country: { type: Type.STRING, description: "The destination country." },
                      passportValidity: { type: Type.STRING, description: "Passport validity requirement (e.g., '6 months')." },
                      blankPages: { type: Type.STRING, description: "Blank pages requirement (e.g., '1 page')." },
                      visaRequired: { type: Type.STRING, description: "Whether a visa is required (e.g., 'Not required for stays under 90 days')." }
                    },
                    required: ["country", "passportValidity", "blankPages", "visaRequired"]
                  }
                },
                {
                  name: "open_url",
                  description: "Opens a specific URL in a new tab for the user.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: { type: Type.STRING, description: "The URL to open." }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "click_element",
                  description: "Simulates a click on a UI element.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      description: { type: Type.STRING },
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER }
                    },
                    required: ["description"]
                  }
                },
                {
                  name: "type_text",
                  description: "Simulates typing into a text field.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      element_description: { type: Type.STRING }
                    },
                    required: ["text", "element_description"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onopen: () => {
            addDebugLog("Gemini Live connected!");
            sessionPromise.then(session => {
              sessionRef.current = session;
              startStreaming(session, micStream);
            });
          },
          onerror: (err) => {
            addDebugLog(`Gemini Live error: ${err}`);
            setError("Connection to AI service failed. Please try again.");
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio Output
            if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              playAudio(message.serverContent.modelTurn.parts[0].inlineData.data);
            }

            // Handle Transcriptions
            if (message.serverContent?.modelTurn?.parts[0]?.text) {
              const text = message.serverContent.modelTurn.parts[0].text;
              setTranscript(prev => [...prev, `Navigator: ${text}`].slice(-5));
            }

            // Handle Interruptions
            if (message.serverContent?.interrupted) {
              addDebugLog("AI Interrupted");
              // Stop all current audio playback
              sourcesRef.current.forEach(source => {
                try { source.stop(); } catch (e) { }
              });
              sourcesRef.current = [];
              nextStartTimeRef.current = 0;
            }

            // Handle Tool Calls
            const toolCall = message.toolCall;
            if (toolCall) {
              const responses: any[] = [];

              for (const call of toolCall.functionCalls) {
                addDebugLog(`Executing Tool: ${call.name} with args: ${JSON.stringify(call.args)}`);
                let result = "Action executed successfully.";

                if (call.name === 'update_destination_info') {
                  const info = call.args as any;
                  setDestinationInfo({
                    country: info.country,
                    passportValidity: info.passportValidity,
                    blankPages: info.blankPages,
                    visaRequired: info.visaRequired
                  });
                  addAction("Alert", `Updated requirements for ${info.country}`);
                  result = `UI updated with requirements for ${info.country}.`;
                } else if (call.name === 'open_url') {
                  const url = call.args.url as string;
                  window.open(url, '_blank');
                  addAction("Navigate", `Opened ${url}`);
                  result = `Opened ${url} in a new tab.`;
                } else if (call.name === 'click_element') {
                  const desc = call.args.description as string;
                  const x = (call.args.x as number) || 50;
                  const y = (call.args.y as number) || 50;
                  moveCursor(x, y).then(() => {
                    setTimeout(() => setShowCursor(false), 1000);
                  });
                  addAction("Click", `Clicking on "${desc}"`);
                  result = `Simulated click on ${desc} at (${x}, ${y}).`;
                } else if (call.name === 'type_text') {
                  const text = call.args.text as string;
                  const desc = call.args.element_description as string;
                  moveCursor(40, 40).then(() => {
                    setTimeout(() => setShowCursor(false), 1000);
                  });
                  addAction("Type", `Typing "${text}" into ${desc}`);
                  result = `Typed text into ${desc}.`;
                }

                responses.push({
                  name: call.name,
                  id: call.id,
                  response: { result }
                });
              }

              if (responses.length > 0) {
                const session = sessionRef.current;
                if (session) {
                  session.sendToolResponse({ functionResponses: responses });
                } else {
                  sessionPromise.then(s => s.sendToolResponse({ functionResponses: responses }));
                }
              }
            }
          },
          onclose: () => {
            addDebugLog("Gemini Live closed");
            stopMonitoring();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err: any) {
      addDebugLog(`Start monitoring failed: ${err.message}`);
      setError(err.message || "An unexpected error occurred while starting Cygnus.");
      stopMonitoring();
    }
  };

  const stopMonitoring = () => {
    setIsActive(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    setStatus('idle');
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (sessionRef.current) {
      sessionRef.current.close();
    }
  };

  const startStreaming = (session: any, micStream: MediaStream) => {
    let frameCount = 0;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !audioContextRef.current) return;

    const ctx = canvas.getContext('2d');

    // Video Streaming
    const sendFrame = () => {
      if (!isRecordingRef.current) return;
      if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
        // Use a smaller internal canvas for streaming to reduce data size
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64Data = canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
        session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'image/jpeg' } });
        frameCount++;
        if (frameCount % 10 === 0) {
          addDebugLog(`Sent ${frameCount} frames...`);
        }
      }
      setTimeout(sendFrame, 1000); // 1fps is enough for UI navigation
    };
    sendFrame();

    // Audio Streaming (Mic)
    const audioContext = audioContextRef.current;
    const source = audioContext.createMediaStreamSource(micStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (!isRecordingRef.current) return;
      const inputData = e.inputBuffer.getChannelData(0);

      // Convert to 16-bit PCM
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
      }

      // Convert to Base64 efficiently
      const bytes = new Uint8Array(pcmData.buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = btoa(binary);
      try {
        if (isRecordingRef.current) {
          session.sendRealtimeInput({ media: { data: base64Audio, mimeType: 'audio/pcm;rate=16000' } });
        }
      } catch (e) {
        // Silent catch for audio during closure
      }
    };
  };

  const playAudio = (base64Data: string) => {
    if (!audioContextRef.current) return;
    const audioContext = audioContextRef.current;

    const binaryString = window.atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcmData = new Int16Array(bytes.buffer);

    const sampleRate = 24000; // Gemini Live output is 24kHz
    const audioBuffer = audioContext.createBuffer(1, pcmData.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 32768;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    // Schedule the chunk
    const currentTime = audioContext.currentTime;
    if (nextStartTimeRef.current < currentTime) {
      nextStartTimeRef.current = currentTime + 0.05; // Small buffer
    }

    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += audioBuffer.duration;

    // Track source to allow stopping on interruption
    sourcesRef.current.push(source);
    source.onended = () => {
      sourcesRef.current = sourcesRef.current.filter(s => s !== source);
    };
  };

  return (
    <div className="min-h-screen bg-[#E6E6E6] text-[#151619] font-sans selection:bg-[#151619] selection:text-white">
      {/* Header */}
      <header className="border-b border-black/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white">
              <Logo />
            </div>
            <div>
              <p className="text-[10px] font-sans uppercase tracking-widest opacity-50">Gemimi Live International Travel Assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/5 rounded-full border border-black/5">
              <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] font-mono uppercase font-bold">
                {isActive ? 'System Active' : 'System Standby'}
              </span>
            </div>
            {!isActive ? (
              <button
                onClick={startMonitoring}
                className="px-6 py-2 bg-[#151619] text-white rounded-xl font-medium hover:bg-black transition-all shadow-lg flex items-center gap-2"
              >
                <Monitor className="w-4 h-4" />
                Start Monitoring
              </button>
            ) : (
              <button
                onClick={stopMonitoring}
                className="px-6 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-all shadow-lg flex items-center gap-2"
              >
                <MicOff className="w-4 h-4" />
                Stop Session
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {error && (
          <div className="lg:col-span-12 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3 text-red-700 shadow-sm animate-in fade-in slide-in-from-top-2">
            <ShieldAlert className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1 flex items-center justify-between">
              <p className="text-sm font-medium">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs font-bold uppercase tracking-widest hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Left Column: Visual Monitoring */}
        <div className="lg:col-span-8 space-y-6 relative">
          <section className="bg-[#151619] rounded-3xl overflow-hidden shadow-2xl aspect-video relative group">
            <div className="w-full h-full relative">
              <video
                ref={videoRef}
                autoPlay
                muted
                className="w-full h-full object-cover opacity-80"
              />
              <canvas ref={canvasRef} width={480} height={270} className="hidden" />

              {/* Virtual Cursor */}
              <AnimatePresence>
                {showCursor && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      left: `${cursorPos.x}%`,
                      top: `${cursorPos.y}%`
                    }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", damping: 20, stiffness: 100 }}
                    className="absolute z-50 pointer-events-none"
                    style={{ transform: 'translate(-50%, -50%)' }}
                  >
                    <div className="relative">
                      <MousePointer2 className="w-8 h-8 text-white fill-[#151619] drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
                      <motion.div
                        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ repeat: Infinity, duration: 1 }}
                        className="absolute inset-0 bg-white/30 rounded-full -z-10"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Overlay UI */}
            <div className="absolute inset-0 p-6 flex flex-col justify-between pointer-events-none">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-mono text-white uppercase tracking-wider">Live Vision Stream</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-white/50 uppercase">Session Time</p>
                  <p className="text-sm font-mono text-white">00:00:00</p>
                </div>
              </div>

              {!isActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto border border-white/20">
                      <Monitor className="w-10 h-10 text-white" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-white font-medium">Ready to Monitor</h3>
                      <p className="text-white/50 text-xs">Share your browser tab to begin flight detection</p>
                    </div>
                  </div>
                </div>
              )}

              {isActive && (
                <div className="flex items-end justify-between">
                  <div className="space-y-4 w-full">
                    <AnimatePresence>
                      {destinationInfo && (
                        <motion.div
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 max-w-sm pointer-events-auto"
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <Globe className="w-4 h-4 text-emerald-400" />
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">{destinationInfo.country} Requirements</h4>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
                              <span className="text-[10px] text-white/50 uppercase">Passport Validity</span>
                              <span className="text-xs text-white font-medium">{destinationInfo.passportValidity}</span>
                            </div>
                            <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
                              <span className="text-[10px] text-white/50 uppercase">Blank Pages</span>
                              <span className="text-xs text-white font-medium">{destinationInfo.blankPages}</span>
                            </div>
                            <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg">
                              <span className="text-[10px] text-white/50 uppercase">Visa Required</span>
                              <span className="text-xs text-white font-medium">{destinationInfo.visaRequired}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => setDestinationInfo(null)}
                            className="mt-3 w-full py-1.5 text-[10px] text-white/40 hover:text-white uppercase font-bold tracking-widest transition-colors"
                          >
                            Dismiss
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] font-mono text-white uppercase">Analyzing Patterns...</span>
                      </div>
                      <div className="h-1 w-48 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-emerald-500"
                          animate={{ width: ['0%', '100%'] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Transcript / Status */}
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 min-h-[160px] flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Mic className="w-4 h-4 text-[#151619]" />
              <h2 className="text-xs font-bold uppercase tracking-widest opacity-50">Agent Thought Stream</h2>
            </div>
            <div className="flex-1 space-y-3">
              {transcript.length === 0 ? (
                <p className="text-sm text-black/30 italic">Navigator is observing your screen and waiting for your intent...</p>
              ) : (
                transcript.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-sm leading-relaxed"
                  >
                    <span className="font-bold text-[#151619] mr-2">NAVIGATOR:</span>
                    <span className="text-black/70">{line.replace('Navigator: ', '')}</span>
                  </motion.div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Navigator Controls */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white rounded-3xl p-8 shadow-xl border border-black/5 space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[#151619]">
                <Monitor className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Manual Intent (Optional)</span>
              </div>
              <p className="text-[10px] text-black/40 leading-tight mb-2">
                Cygnus monitors automatically, but you can also type specific requests here.
              </p>
              <textarea
                value={userIntent}
                onChange={(e) => setUserIntent(e.target.value)}
                placeholder="What should I do for you? (e.g., 'Find the login button')"
                className="w-full p-4 bg-black/5 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10 min-h-[100px] resize-none"
              />
              <button
                onClick={() => {
                  if (sessionRef.current && userIntent) {
                    sessionRef.current.sendRealtimeInput({ text: `User Intent: ${userIntent}` });
                    setUserIntent("");
                  }
                }}
                disabled={!isActive || !userIntent}
                className="w-full py-3 bg-[#151619] text-white rounded-xl font-medium disabled:opacity-50 transition-all"
              >
                Send Intent
              </button>
            </div>
          </section>

          <section className="bg-white rounded-3xl p-8 shadow-xl border border-black/5 space-y-6">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#151619]" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-50">Navigation Feed</h3>
            </div>
            <div className="space-y-4">
              {actionHistory.length === 0 ? (
                <p className="text-xs text-black/30 italic">No actions performed yet.</p>
              ) : (
                actionHistory.map((action, i) => (
                  <div key={i} className="flex gap-3 items-start border-b border-black/5 pb-3 last:border-0">
                    <div className="w-8 h-8 bg-black/5 rounded-lg flex items-center justify-center flex-shrink-0">
                      {action.type === 'Click' && <MousePointer2 className="w-3.5 h-3.5 text-blue-500" />}
                      {action.type === 'Type' && <Mic className="w-3.5 h-3.5 text-purple-500" />}
                      {action.type === 'Alert' && <ShieldAlert className="w-3.5 h-3.5 text-red-500" />}
                      {action.type === 'Tutorial' && <Globe className="w-3.5 h-3.5 text-emerald-500" />}
                      {action.type === 'Navigate' && <ExternalLink className="w-3.5 h-3.5 text-amber-500" />}
                      {action.type === 'Scroll' && <ChevronRight className="w-3.5 h-3.5 rotate-90 text-gray-500" />}
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-mono uppercase opacity-50">{action.timestamp}</p>
                      <p className="text-xs font-medium">{action.detail}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="bg-white rounded-3xl p-8 shadow-xl border border-black/5 space-y-4">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[#151619]" />
              <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-50">System Logs</h3>
            </div>
            <div className="space-y-2">
              {debugLogs.length === 0 ? (
                <p className="text-[10px] text-black/30 italic">System ready...</p>
              ) : (
                debugLogs.map((log, i) => (
                  <p key={i} className="text-[10px] font-mono text-black/60 border-l-2 border-black/10 pl-2 py-0.5">
                    {log}
                  </p>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 border-t border-black/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] font-mono uppercase opacity-40">© 2026 UI Navigator Systems • Powered by Gemini Live</p>
          <div className="flex gap-6">
            <a href="#" className="text-[10px] font-mono uppercase opacity-40 hover:opacity-100 transition-opacity">Privacy Policy</a>
            <a href="#" className="text-[10px] font-mono uppercase opacity-40 hover:opacity-100 transition-opacity">Terms of Service</a>
            <a href="#" className="text-[10px] font-mono uppercase opacity-40 hover:opacity-100 transition-opacity">Contact Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
