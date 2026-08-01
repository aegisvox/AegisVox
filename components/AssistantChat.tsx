'use client'

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'xterm/css/xterm.css';

type SkillCanvasState = {
  active: boolean;
  name: string;
  text?: string;
  data?: Record<string, unknown> | null;
  mode?: 'fullscreen' | 'bubble';
  html?: string;
  placement?: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'custom';
  offsetX?: number;
  offsetY?: number;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  html?: string;
  isStreaming?: boolean;
};

type ModelStatus = {
  llmReady: boolean;
  whisperReady: boolean;
  ttsReady: boolean;
  installing: boolean;
  progress: number;
  message: string;
  error: string | null;
};

type AuthorizationPromptState = {
  skill: string;
  permission: string;
  message: string;
};

const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const humanizeSkillName = (name: string) => name.replace(/-/g, ' ');

function renderMarkdownContent(text: string) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-7 text-slate-200 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-pre:border prose-pre:border-cyan-400/20 prose-pre:bg-slate-950/70 prose-pre:p-3 prose-code:rounded prose-code:bg-slate-800/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-cyan-300 prose-a:text-cyan-300 prose-a:no-underline hover:prose-a:underline">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function HtmlContent({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousHtml = useRef<string | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    if (previousHtml.current === html) return;
    containerRef.current.innerHTML = html;
    previousHtml.current = html;
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="prose prose-invert max-w-none text-sm leading-7 text-slate-200 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-pre:border prose-pre:border-cyan-400/20 prose-pre:bg-slate-950/70 prose-pre:p-3 prose-code:rounded prose-code:bg-slate-800/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-cyan-300 prose-a:text-cyan-300 prose-a:no-underline hover:prose-a:underline"
    />
  );
}

export default function AssistantChat() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [skillCanvas, setSkillCanvas] = useState<SkillCanvasState | null>(null);
  const [authorizationPrompt, setAuthorizationPrompt] = useState<AuthorizationPromptState | null>(null);
  const [deviceCode, setDeviceCode] = useState('');
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [installRequested, setInstallRequested] = useState(false);
  const [bubblePosition, setBubblePosition] = useState({ x: 0, y: 0 });
  const [isDraggingBubble, setIsDraggingBubble] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<{ dispose: () => void; clear: () => void; write: (text: string) => void } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined' || !terminalContainerRef.current) return;

    let disposed = false;

    const initializeTerminal = async () => {
      const { Terminal } = await import('xterm');
      if (disposed || !terminalContainerRef.current) return;

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'monospace',
        fontSize: 14,
        theme: {
          background: '#020805',
          foreground: '#86efac',
          cursor: '#86efac',
          brightGreen: '#4ade80',
          green: '#34d399',
          red: '#f87171',
          yellow: '#fbbf24',
        },
        scrollback: 200,
      });

      terminal.open(terminalContainerRef.current);
      terminalInstanceRef.current = terminal;
    };

    void initializeTerminal();

    return () => {
      disposed = true;
      terminalInstanceRef.current?.dispose();
      terminalInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!terminalInstanceRef.current || !modelStatus || (modelStatus.llmReady && modelStatus.whisperReady && modelStatus.ttsReady)) return;

    const terminal = terminalInstanceRef.current;
    const lines = [
      'Aegis local environment',
      '======================',
      '$ models status',
      `llm: ${modelStatus.llmReady ? 'ready' : 'missing'}`,
      `speech: ${modelStatus.whisperReady ? 'ready' : 'missing'}`,
      `tts: ${modelStatus.ttsReady ? 'ready' : 'missing'}`,
      modelStatus.message,
      ...(modelStatus.error ? [modelStatus.error] : []),
      '',
      '$ install llm model?',
      'Local models are not ready yet. Install the language model now?',
      '',
      modelStatus.installing ? 'Installing…' : 'Awaiting command...',
    ];

    terminal.clear();
    terminal.write(lines.join('\r\n'));
    terminal.write('\r\n\r\nroot@aegis:~# ');
  }, [modelStatus]);

  const getApiBaseUrl = () => {
    if (typeof window === 'undefined') return '';

    const protocol = window.location.protocol;
    const githubMatch = window.location.host.match(/^(.*)-3000\.app\.github\.dev$/);

    return githubMatch
      ? `${protocol}//${githubMatch[1]}-8000.app.github.dev`
      : `${protocol}//${window.location.hostname}:${window.location.port === '3000' ? '8000' : window.location.port || '8000'}`;
  };

  const sendSocketMessage = (payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const githubMatch = window.location.host.match(/^(.*)-3000\.app\.github\.dev$/);
    const computedSocketUrl = githubMatch
      ? `${protocol}://${githubMatch[1]}-8000.app.github.dev/ws/live`
      : `${protocol}://${window.location.hostname}:${window.location.port === '3000' ? '8000' : window.location.port || '8000'}/ws/live`;

    const socket = new WebSocket(computedSocketUrl);
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      sendSocketMessage({ type: 'get_device_code' });
      sendSocketMessage({ type: 'get_model_status' });
    });

    const statusTimer = window.setInterval(() => {
      sendSocketMessage({ type: 'get_model_status' });
    }, 3000);

    const parseSafeJson = (value: string) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    socket.addEventListener('message', (event) => {
      try {
        const message = typeof event.data === 'string'
          ? JSON.parse(event.data)
          : JSON.parse(new TextDecoder().decode(event.data));

        if (message.type === 'transcript' && typeof message.text === 'string' && message.text.trim()) {
          setMessages((prev) => [...prev, { id: createMessageId(), role: 'user', content: message.text.trim() }]);
          return;
        }

        if (message.type === 'device_code' && typeof message.code === 'string') {
          setDeviceCode(message.code);
          return;
        }

        if (message.type === 'model_status') {
          const nextStatus: ModelStatus = {
            llmReady: Boolean(message.llmReady),
            whisperReady: Boolean(message.whisperReady),
            ttsReady: Boolean(message.ttsReady),
            installing: Boolean(message.installing),
            progress: typeof message.progress === 'number' ? message.progress : 0,
            message: typeof message.message === 'string' ? message.message : 'Waiting for installation.',
            error: typeof message.error === 'string' ? message.error : null,
          };
          setModelStatus(nextStatus);
          setInstallRequested(Boolean(nextStatus.installing));
          return;
        }

        if (message.type === 'permission_required') {
          setAuthorizationPrompt({
            skill: message.skill,
            permission: message.permission,
            message: typeof message.message === 'string' ? message.message : 'This skill needs your approval before it can continue.',
          });
          return;
        }

        if (message.type === 'permission_granted') {
          setAuthorizationPrompt(null);
          setMessages((prev) => [...prev, { id: createMessageId(), role: 'system', content: `Authorized ${humanizeSkillName(message.skill || '')}.` }]);
          return;
        }

        if (message.type === 'permission_denied') {
          setAuthorizationPrompt(null);
          setMessages((prev) => [...prev, { id: createMessageId(), role: 'system', content: `Authorization was declined for ${humanizeSkillName(message.skill || '')}.` }]);
          return;
        }

        if (message.type === 'response_start') {
          setMessages((prev) => [...prev, { id: createMessageId(), role: 'assistant', content: '', isStreaming: true }]);
          return;
        }

        if (message.type === 'speech_chunk' && typeof message.text === 'string') {
          setMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;
            const incomingText = message.text;

            if (incomingText === '') {
              return next;
            }

            if (lastIndex >= 0 && next[lastIndex].role === 'assistant' && next[lastIndex].isStreaming) {
              const previousText = next[lastIndex].content;
              next[lastIndex] = {
                ...next[lastIndex],
                content: `${previousText}${incomingText}`,
              };
              return next;
            }

            next.push({ id: createMessageId(), role: 'assistant', content: incomingText, isStreaming: true });
            return next;
          });
          return;
        }

        if (message.type === 'response_end') {
          setMessages((prev) => {
            const next = [...prev];
            const lastIndex = next.length - 1;

            if (lastIndex >= 0 && next[lastIndex].role === 'assistant') {
              next[lastIndex] = { ...next[lastIndex], isStreaming: false };
            }

            return next;
          });
          return;
        }

        if (message.type === 'skill_start') {
          setMessages((prev) => [...prev, { id: createMessageId(), role: 'system', content: `Opening ${message.name}...` }]);
          return;
        }

        if (message.type === 'skill_end') {
          const rawOutput = message.output;
          const parsedOutput = typeof rawOutput === 'string' ? parseSafeJson(rawOutput) ?? rawOutput : rawOutput;
          const skillText = typeof parsedOutput === 'string'
            ? parsedOutput
            : parsedOutput && typeof parsedOutput === 'object' && 'data' in parsedOutput
              ? JSON.stringify((parsedOutput as { data?: Record<string, unknown> }).data ?? parsedOutput, null, 2)
              : JSON.stringify(parsedOutput, null, 2);

          const htmlContent = parsedOutput && typeof parsedOutput === 'object' && typeof (parsedOutput as { html?: string }).html === 'string'
            ? (parsedOutput as { html?: string }).html
            : undefined;

          setMessages((prev) => [...prev, { id: createMessageId(), role: 'system', content: skillText, html: htmlContent }]);
          setSkillCanvas(null);
        }
      } catch {
        // Ignore malformed socket payloads.
      }
    });

    return () => {
      window.clearInterval(statusTimer);
      socket.close();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, []);

  const startModelInstallation = async () => {
    if (installRequested) return;

    setInstallRequested(true);
    setModelStatus((prev) => prev ? {
      ...prev,
      installing: true,
      message: 'Starting model installation…',
      error: null,
    } : prev);

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendSocketMessage({ type: 'install_models' });
      return;
    }

    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) return;

    try {
      const response = await fetch(`${apiBaseUrl}/models/install`, { method: 'POST' });
      const data = await response.json();

      setModelStatus((prev) => prev ? {
        ...prev,
        installing: Boolean(data.installing || data.started),
        message: data.message || prev.message,
        error: data.error || null,
      } : prev);
    } catch {
      setModelStatus((prev) => prev ? {
        ...prev,
        installing: false,
        error: 'Failed to start model installation.',
      } : prev);
    }
  };

  const sendPrompt = (prompt: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: 'prompt', text: prompt }));
  };

  const approveAuthorization = () => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !authorizationPrompt || !deviceCode) return;

    socket.send(JSON.stringify({
      type: 'grant_permission',
      skill: authorizationPrompt.skill,
      permission: authorizationPrompt.permission,
      verification_code: deviceCode,
    }));

    setAuthorizationPrompt(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!inputText.trim()) return;

      const trimmedPrompt = inputText.trim();
      setMessages((prev) => [...prev, { id: createMessageId(), role: 'user', content: trimmedPrompt }]);
      sendPrompt(trimmedPrompt);
      setInputText('');
    }
  };

  const mapUrl = skillCanvas?.data?.map_url as string | undefined;
  const showCanvas = skillCanvas?.active;

  const getBubbleStyle = () => {
    if (!skillCanvas || skillCanvas.mode !== 'bubble') return undefined;

    const placement = skillCanvas.placement || 'center';
    const baseOffsetX = skillCanvas.offsetX ?? 0;
    const baseOffsetY = skillCanvas.offsetY ?? 0;
    const customOffset = placement === 'custom' ? { left: baseOffsetX, top: baseOffsetY } : undefined;

    switch (placement) {
      case 'left':
        return { left: `${baseOffsetX}px`, top: `${baseOffsetY}px`, transform: 'none' };
      case 'right':
        return { right: `${baseOffsetX}px`, top: `${baseOffsetY}px`, transform: 'none' };
      case 'top':
        return { top: `${baseOffsetY}px`, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom':
        return { bottom: `${baseOffsetY}px`, left: '50%', transform: 'translateX(-50%)' };
      case 'custom':
        return customOffset;
      case 'center':
      default:
        return { left: '50%', top: `${baseOffsetY}px`, transform: 'translateX(-50%)' };
    }
  };

  const handleBubblePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (skillCanvas?.mode !== 'bubble') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDraggingBubble(true);
    setBubblePosition({ x: event.clientX, y: event.clientY });
  };

  const handleBubblePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!isDraggingBubble || skillCanvas?.mode !== 'bubble') return;
    const deltaX = event.clientX - bubblePosition.x;
    const deltaY = event.clientY - bubblePosition.y;
    setBubblePosition({ x: event.clientX, y: event.clientY });
    setSkillCanvas((prev) => prev && prev.mode === 'bubble' ? {
      ...prev,
      offsetX: (prev.offsetX ?? 0) + deltaX,
      offsetY: (prev.offsetY ?? 0) + deltaY,
    } : prev);
  };

  const handleBubblePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (skillCanvas?.mode !== 'bubble') return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDraggingBubble(false);
  };

  return (
    <div className="fixed inset-0 h-dvh overflow-hidden bg-black text-white">
      {modelStatus && (!modelStatus.llmReady || !modelStatus.whisperReady || !modelStatus.ttsReady) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-emerald-400/25 bg-[#07110d] shadow-[0_0_70px_rgba(16,185,129,0.18)]">
            <div className="flex items-center gap-2 border-b border-emerald-400/20 bg-[#0b140f] px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-emerald-500/80">aegis@local:~</span>
            </div>
            <div className="h-[420px] bg-[#020805] p-2">
              <div ref={terminalContainerRef} className="h-full w-full" />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-emerald-400/20 bg-[#0b140f] px-3 py-3">
              <button
                type="button"
                onClick={() => startModelInstallation()}
                disabled={installRequested || modelStatus.installing}
                className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {modelStatus.installing ? 'Installing…' : 'Install LLM'}
              </button>
              <button
                type="button"
                onClick={() => setModelStatus((prev) => prev ? { ...prev, message: 'Skipped for now.' } : prev)}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-200 transition hover:bg-white/10"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
      {showCanvas && (
        <div className="absolute inset-0 z-0 overflow-hidden bg-black/90">
          {skillCanvas?.mode === 'bubble' ? (
            <div className="absolute inset-0 z-20">
              <div
                ref={bubbleRef}
                className="absolute w-[min(92vw,560px)] max-w-[calc(100vw-1rem)] rounded-[24px] border border-transparent bg-transparent shadow-none"
                style={getBubbleStyle()}
              >
                <div className="flex items-start">
                  <div className="flex-1 min-w-0 overflow-hidden rounded-[24px] shadow-none">
                    {skillCanvas.html ? (
                      <HtmlContent html={skillCanvas.html} />
                    ) : mapUrl ? (
                      <iframe
                        src={mapUrl}
                        title={skillCanvas.name}
                        className="h-[280px] w-full rounded-[18px] border-0 sm:h-[320px]"
                        allowFullScreen
                      />
                    ) : (
                      <div className="text-sm text-slate-200 sm:text-base">{skillCanvas.text ?? 'Displaying skill output on screen.'}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onPointerDown={handleBubblePointerDown}
                    onPointerMove={handleBubblePointerMove}
                    onPointerUp={handleBubblePointerUp}
                    onPointerLeave={handleBubblePointerUp}
                    className="ml-2 mt-1 flex-shrink-0 rounded-full border border-cyan-400/20 bg-slate-950/70 px-2.5 py-2 text-[10px] uppercase tracking-[0.24em] text-cyan-200/80 transition hover:bg-cyan-400/10"
                  >
                    Move
                  </button>
                </div>
              </div>
            </div>
          ) : mapUrl ? (
            <iframe
              src={mapUrl}
              title={skillCanvas.name}
              className="h-full w-full border-0"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 py-4 text-white sm:px-6">
              <div className="max-w-3xl rounded-3xl border border-cyan-400/20 bg-slate-950/70 p-4 text-sm text-white shadow-[0_0_60px_rgba(56,189,248,0.12)] backdrop-blur-xl sm:p-6">
                <div className="mb-4 text-base font-semibold sm:text-lg">{skillCanvas.name}</div>
                <pre className="whitespace-pre-wrap break-words text-xs text-slate-200 sm:text-sm">
                  {skillCanvas.text ?? 'Displaying skill output on screen.'}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={`pointer-events-none absolute inset-0 z-10 flex px-3 py-3 pb-24 sm:px-6 sm:py-4 sm:pb-28 lg:px-8 ${showCanvas && skillCanvas?.mode === 'bubble' ? 'pt-20 sm:pt-40' : ''}`}>
          <div className="pointer-events-auto mx-auto flex h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto p-2 sm:p-4 custom-scrollbar">
            {messages.length === 0 ? (
              <div className="rounded-2xl px-3 py-2 text-sm text-slate-200 sm:px-4 sm:py-3">
                
              </div>
            ) : (
              messages.map((message) => {
              const isUser = message.role === 'user';
              const isSystem = message.role === 'system';

              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[92%] rounded-[20px] px-3 py-2.5 sm:max-w-[88%] sm:px-4 sm:py-3 ${
                      isUser
                        ? 'bg-cyan-400/8 text-cyan-50'
                        : isSystem
                          ? 'bg-amber-400/8 text-slate-100'
                          : 'bg-white/5 text-slate-100'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-slate-400/80 sm:text-[11px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${isUser ? 'bg-cyan-300' : isSystem ? 'bg-amber-300' : 'bg-slate-400'}`} />
                      {isUser ? 'You' : isSystem ? 'Skill' : 'Aegis'}
                    </div>
                    {message.isStreaming && !message.content ? (
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
                        Thinking…
                      </div>
                    ) : message.html ? (
                      <HtmlContent html={message.html} />
                    ) : (
                      renderMarkdownContent(message.content)
                    )}
                  </div>
                </div>
              );
            })
            )}
            <div ref={messagesEndRef} />
          </div>
      </div>

      {authorizationPrompt && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-4">
          <div className="w-full max-w-md rounded-[24px] border border-cyan-400/20 bg-slate-950/85 p-4 text-white shadow-[0_0_45px_rgba(6,182,212,0.16)] sm:p-5">
            <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-cyan-300/80">Authorization needed</div>
            <div className="mb-2 text-lg font-semibold">{humanizeSkillName(authorizationPrompt.skill)}</div>
            <p className="mb-4 text-sm leading-6 text-slate-300">{authorizationPrompt.message}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAuthorizationPrompt(null)}
                className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={approveAuthorization}
                className="rounded-full bg-cyan-400/20 px-3 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/30"
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex h-dvh items-end justify-center px-0 pb-4 sm:pb-6 lg:pb-10">
        <div className="relative w-full px-3 py-3 sm:px-5 sm:py-4">
          <div className="absolute inset-x-0 -top-[1px] h-[calc(100%+3px)] rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute inset-x-0 -top-[1px] h-[calc(100%+3px)] rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative mx-auto w-full max-w-5xl">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="w-full rounded-full border border-cyan-400/20 bg-[#111217] px-4 py-3 text-sm text-white transition placeholder-slate-500 focus:outline-none focus:border-transparent focus:ring-0 sm:px-6 sm:py-4"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
