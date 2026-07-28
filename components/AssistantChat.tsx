'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  isVoice?: boolean;
  // Skill Execution Metadata
  messageType?: 'text' | 'skill';
  skillName?: string;
  skillStatus?: 'running' | 'completed' | 'failed';
  skillOutput?: string;
}

interface SyncChunk {
  text: string;
  audioBlob: Blob;
}

const VOICE_OPTIONS = [
  { id: 'af_heart', label: '🇺🇸 Heart (US Female - Warm / Default)' },
  { id: 'af_alloy', label: '🇺🇸 Alloy (US Female)' },
  { id: 'af_bella', label: '🇺🇸 Bella (US Female - Natural)' },
  { id: 'am_adam', label: '🇺🇸 Adam (US Male - Deep & Authoritative)' },
  { id: 'am_echo', label: '🇺🇸 Echo (US Male - Resonant)' },
  { id: 'bf_emma', label: '🇬🇧 Emma (UK Female - Classic Narrator)' },
  { id: 'bm_george', label: '🇬🇧 George (UK Male - Mature)' },
  { id: 'ef_dora', label: '🇪🇸 Dora (Spanish Female)' },
  { id: 'ff_siwis', label: '🇫🇷 Siwis (French Female - Classic)' },
  { id: 'hf_alpha', label: '🇮🇳 Alpha (Hindi Female)' },
  { id: 'jf_alpha', label: '🇯🇵 Alpha (Japanese Female)' },
];

const getWebSocketUrl = (): string => {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;

  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';

  if (hostname.includes('.app.github.dev') || hostname.includes('.preview.app.github.dev')) {
    const backendHostname = hostname.replace(/-3000(?=\.)/, '-8000');
    return `${wsProtocol}//${backendHostname}/ws/live`;
  }
  return `${wsProtocol}//${hostname}:8000/ws/live`;
};

export default function AssistantChat() {
  const [inputText, setInputText] = useState<string>('');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(true);
  const [selectedVoice, setSelectedVoice] = useState<string>('af_heart');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Added 'executing' state for when skills/tools are running
  const [visualizerStatus, setVisualizerStatus] = useState<'idle' | 'listening' | 'speaking' | 'executing'>('idle');

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const autoSpeakRef = useRef<boolean>(true);

  const syncQueueRef = useRef<SyncChunk[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const pendingTextQueueRef = useRef<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isAudioConnectedRef = useRef<boolean>(false);
  const animFrameRef = useRef<number>(0);
  const micStreamRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const initAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      if (audioRef.current && !isAudioConnectedRef.current) {
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        isAudioConnectedRef.current = true;
      }
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const processSyncQueue = useCallback(() => {
    if (isPlayingRef.current || syncQueueRef.current.length === 0) {
      if (syncQueueRef.current.length === 0 && !isPlayingRef.current) {
        setVisualizerStatus('idle');
      }
      return;
    }

    isPlayingRef.current = true;
    initAudioContext();
    setVisualizerStatus('speaking');

    const nextChunk = syncQueueRef.current.shift()!;

    setMessages((prev) => {
      const newMessages = [...prev];
      const lastMsg = newMessages[newMessages.length - 1];
      
      if (lastMsg && lastMsg.sender === 'ai' && lastMsg.messageType !== 'skill') {
        lastMsg.text = (lastMsg.text + ' ' + nextChunk.text).trim();
      } else {
        newMessages.push({
          id: Date.now().toString(),
          sender: 'ai',
          text: nextChunk.text,
          messageType: 'text'
        });
      }
      return newMessages;
    });

    if (audioRef.current) {
      const audioUrl = URL.createObjectURL(nextChunk.audioBlob);
      audioRef.current.src = audioUrl;
      
      audioRef.current.play().catch((err) => {
        console.warn('Autoplay blocked:', err);
        isPlayingRef.current = false;
        processSyncQueue();
      });

      audioRef.current.onended = () => {
        URL.revokeObjectURL(audioUrl);
        isPlayingRef.current = false;
        processSyncQueue();
      };
    }
  }, [initAudioContext]);

  // 🎨 NCS Canvas Rendering Loop (Updated with Neon Purple 'executing' state)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let angleOffset = 0;

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = 70;

      ctx.fillStyle = 'rgba(10, 10, 10, 0.3)';
      ctx.fillRect(0, 0, width, height);

      const analyser = analyserRef.current;
      const bufferLength = analyser ? analyser.frequencyBinCount : 128;
      const dataArray = new Uint8Array(bufferLength);

      if (analyser && (visualizerStatus === 'speaking' || visualizerStatus === 'listening')) {
        analyser.getByteFrequencyData(dataArray);
      } else if (visualizerStatus === 'executing') {
        // High-frequency synthetic computing wave
        const time = Date.now() * 0.01;
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.floor(80 + Math.sin(time + i * 0.3) * 60 + Math.cos(time * 2 + i * 0.1) * 40);
        }
      } else {
        const time = Date.now() * 0.002;
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.floor(15 + Math.sin(time + i * 0.1) * 10);
        }
      }

      let primaryColor = '#FACC15'; // Neon Gold (Speaking)
      let glowColor = 'rgba(250, 204, 21, 0.8)';
      
      if (visualizerStatus === 'listening') {
        primaryColor = '#00F0FF'; // Neon Cyan (Listening)
        glowColor = 'rgba(0, 240, 255, 0.8)';
      } else if (visualizerStatus === 'executing') {
        primaryColor = '#C084FC'; // Neon Purple (Skill Execution)
        glowColor = 'rgba(192, 132, 252, 0.9)';
      } else if (visualizerStatus === 'idle') {
        primaryColor = '#525252';
        glowColor = 'rgba(82, 82, 82, 0.3)';
      }

      ctx.strokeStyle = primaryColor;
      ctx.shadowBlur = visualizerStatus === 'idle' ? 5 : 25;
      ctx.shadowColor = glowColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      // Spin faster when computing/executing a skill
      angleOffset += visualizerStatus === 'executing' ? 0.008 : 0.002;

      const bars = 64;
      const step = (Math.PI * 2) / bars;

      for (let i = 0; i < bars; i++) {
        const dataIndex = Math.floor(Math.abs(i - bars / 2) * (bufferLength / (bars / 2)));
        const amplitude = (dataArray[dataIndex] || 0) / 255;
        const barHeight = amplitude * (visualizerStatus === 'executing' ? 45 : 60);

        const angle = i * step + angleOffset;

        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + barHeight);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius - 5, 0, Math.PI * 2);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.shadowBlur = 0;
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [visualizerStatus]);

  // 🌐 WebSocket Lifecycle & Skill Execution Router
  useEffect(() => {
    const wsUrl = getWebSocketUrl();
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        if (autoSpeakRef.current) {
          const matchingText = pendingTextQueueRef.current.shift() || '';
          syncQueueRef.current.push({ text: matchingText, audioBlob: event.data });
          processSyncQueue();
        } else {
          pendingTextQueueRef.current.shift();
        }
      } else {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'transcript') {
            setMessages((prev) => [...prev, { id: Date.now().toString(), sender: 'user', text: data.text, isVoice: true }]);
          } 
          // ⚡ SKILL START EVENT: Show spinning action card & change visualizer to purple
          else if (data.type === 'skill_start') {
            setVisualizerStatus('executing');
            setMessages((prev) => [
              ...prev,
              {
                id: data.skill_id || Date.now().toString(),
                sender: 'system',
                text: data.description || `Executing skill: ${data.name}...`,
                messageType: 'skill',
                skillName: data.name,
                skillStatus: 'running'
              }
            ]);
          } 
          // ⚡ SKILL END EVENT: Update action card to completed & display result
          else if (data.type === 'skill_end') {
            setVisualizerStatus('idle');
            setMessages((prev) => 
              prev.map((msg) => 
                msg.skillName === data.name && msg.skillStatus === 'running'
                  ? { ...msg, skillStatus: 'completed', skillOutput: data.output }
                  : msg
              )
            );
          } 
          else if (data.type === 'response_start') {
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.sender === 'ai' && lastMsg.text === '') return prev;
              return [...prev, { id: Date.now().toString(), sender: 'ai', text: '', messageType: 'text' }];
            });
          } 
          else if (data.type === 'speech_chunk') {
            if (!autoSpeakRef.current) {
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg && lastMsg.sender === 'ai' && lastMsg.messageType !== 'skill') {
                  lastMsg.text = (lastMsg.text + ' ' + data.text).trim();
                } else {
                  newMessages.push({ id: Date.now().toString(), sender: 'ai', text: data.text, messageType: 'text' });
                }
                return newMessages;
              });
            } else {
              pendingTextQueueRef.current.push(data.text);
            }
          }
        } catch (err) {
          console.error('Failed to parse incoming JSON:', err);
        }
      }
    };

    return () => {
      ws.close();
    };
  }, [processSyncQueue]);

  const handleVoiceChange = (newVoice: string) => {
    setSelectedVoice(newVoice);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'config', voice: newVoice }));
    }
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !socketRef.current) return;
    initAudioContext();

    socketRef.current.send(JSON.stringify({ type: 'prompt', text: inputText, voice: selectedVoice }));
    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: 'user', text: inputText }]);
    setInputText('');
  };

  const toggleRecording = async () => {
    initAudioContext();
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setVisualizerStatus('idle');
      micStreamRef.current?.disconnect();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (audioCtxRef.current && analyserRef.current) {
        const micSource = audioCtxRef.current.createMediaStreamSource(stream);
        micSource.connect(analyserRef.current);
        micStreamRef.current = micSource;
        setVisualizerStatus('listening');
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(audioBlob);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert('Microphone access denied or unavailable.');
    }
  };

  return (
    <div className="flex flex-col h-[740px] w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-3xl shadow-2xl overflow-hidden font-sans text-neutral-100">
      <audio ref={audioRef} className="hidden" crossOrigin="anonymous" />

      {/* Header */}
      <div className="px-6 py-4 bg-neutral-900/80 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full animate-pulse ${
            visualizerStatus === 'speaking' ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50' : 
            visualizerStatus === 'listening' ? 'bg-cyan-400 shadow-lg shadow-cyan-400/50' : 
            visualizerStatus === 'executing' ? 'bg-purple-400 shadow-lg shadow-purple-400/50' : 'bg-neutral-600'
          }`} />
          <span className="text-sm font-bold tracking-wider uppercase bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 bg-clip-text text-transparent">
            GemmaLive Audio Deck
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedVoice}
            onChange={(e) => handleVoiceChange(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 text-neutral-300 text-xs rounded-full px-3 py-1.5 focus:outline-none focus:border-yellow-500 transition cursor-pointer max-w-[200px] truncate"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id} className="bg-neutral-900 text-neutral-200">{v.label}</option>
            ))}
          </select>

          <button
            onClick={() => {
              initAudioContext();
              const nextState = !autoSpeak;
              setAutoSpeak(nextState);
              if (!nextState && pendingTextQueueRef.current.length > 0) {
                const remainingText = pendingTextQueueRef.current.join(' ');
                pendingTextQueueRef.current = [];
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg && lastMsg.sender === 'ai') lastMsg.text = (lastMsg.text + ' ' + remainingText).trim();
                  else newMessages.push({ id: Date.now().toString(), sender: 'ai', text: remainingText });
                  return newMessages;
                });
              }
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              autoSpeak ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-300' : 'bg-neutral-900 border-neutral-800 text-neutral-500'
            }`}
          >
            {autoSpeak ? '🔊 Audio On' : '🔇 Muted'}
          </button>
        </div>
      </div>

      {/* NCS Visualizer Ring */}
      <div className="relative flex flex-col items-center justify-center bg-gradient-to-b from-neutral-950 via-neutral-900/40 to-neutral-950 border-b border-neutral-800/80 py-4 h-[280px]">
        <canvas ref={canvasRef} width={360} height={260} className="absolute inset-0 m-auto z-0 pointer-events-none" />
        <div className="z-10 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-black tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">GEMMA</div>
          <div className={`text-[10px] font-mono tracking-widest uppercase mt-0.5 transition-colors ${
            visualizerStatus === 'speaking' ? 'text-yellow-400 font-bold animate-pulse' :
            visualizerStatus === 'listening' ? 'text-cyan-400 font-bold animate-pulse' :
            visualizerStatus === 'executing' ? 'text-purple-400 font-bold animate-pulse' : 'text-neutral-500'
          }`}>
            {visualizerStatus === 'speaking' ? '• Synthesizing •' :
             visualizerStatus === 'listening' ? '• Listening •' :
             visualizerStatus === 'executing' ? '• Executing Skill •' : '• System Idle •'}
          </div>
        </div>
      </div>

      {/* Message Feed with Skill Cards */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-neutral-950/50">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-neutral-600 text-xs text-center space-y-1">
            <p>No messages yet.</p>
            <p>Try asking: Check the weather in Tokyo to trigger a skill!</p>
          </div>
        ) : (
          messages.map((msg) => {
            // ⚡ RENDER TERMINAL-STYLE ACTION CARDS FOR SKILLS
            if (msg.messageType === 'skill') {
              return (
                <div key={msg.id} className="mx-auto w-[90%] bg-neutral-900/90 border border-purple-500/30 rounded-2xl p-4 shadow-lg shadow-purple-950/20 font-mono text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-neutral-800 mb-2">
                    <div className="flex items-center gap-2 text-purple-400 font-bold">
                      <span className={msg.skillStatus === 'running' ? 'animate-spin' : ''}>
                        {msg.skillStatus === 'running' ? '⚙️' : '⚡'}
                      </span>
                      <span>SKILL: {msg.skillName}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                      msg.skillStatus === 'running' ? 'bg-purple-500/20 text-purple-300 animate-pulse' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {msg.skillStatus}
                    </span>
                  </div>
                  <div className="text-neutral-300 font-sans mb-1">{msg.text}</div>
                  {msg.skillOutput && (
                    <div className="mt-2 p-2 bg-neutral-950 rounded border border-neutral-800/80 text-emerald-400 overflow-x-auto">
                      <span className="text-neutral-500 block text-[9px] uppercase tracking-wider mb-0.5">Return Payload:</span>
                      <code>{msg.skillOutput}</code>
                    </div>
                  )}
                </div>
              );
            }

            // STANDARD CHAT BUBBLE
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed transition-all ${
                  msg.sender === 'user'
                    ? 'ml-auto bg-neutral-900 border border-neutral-700/80 text-yellow-100 rounded-br-none shadow-sm'
                    : 'mr-auto bg-neutral-900/80 border border-neutral-800 text-neutral-200 rounded-bl-none shadow-sm'
                }`}
              >
                <div className="text-[10px] uppercase font-semibold tracking-wider text-neutral-400 mb-1">
                  {msg.sender === 'user' ? (msg.isVoice ? '🎙️ You (Spoken)' : '⌨️ You (Typed)') : '🤖 Gemma 4'}
                </div>
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSendText} className="p-4 bg-neutral-900 border-t border-neutral-800 flex items-center gap-3 z-10">
        <button
          type="button"
          onClick={toggleRecording}
          className={`p-3.5 rounded-2xl transition border flex items-center justify-center ${
            isRecording ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 animate-pulse shadow-[0_0_15px_rgba(0,240,255,0.3)]' : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:text-white'
          }`}
        >
          {isRecording ? '⏹️' : '🎙️'}
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={isRecording ? 'Microphone active...' : 'Send a command or trigger a tool...'}
          disabled={isRecording}
          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-3.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-yellow-500 transition disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isRecording}
          className="px-6 py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-neutral-950 text-sm font-bold rounded-2xl transition shadow-[0_0_15px_rgba(250,204,21,0.2)] disabled:shadow-none"
        >
          Send
        </button>
      </form>
    </div>
  );
}