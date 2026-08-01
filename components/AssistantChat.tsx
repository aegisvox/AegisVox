'use client'

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const originProtocol = window.location.protocol;
    const githubMatch = window.location.host.match(/^(.*)-3000\.app\.github\.dev$/);
    const socketUrl = githubMatch
      ? `${protocol}://${githubMatch[1]}-8000.app.github.dev/ws/live`
      : `${protocol}://${window.location.hostname}:${window.location.port === '3000' ? '8000' : window.location.port || '8000'}/ws/live`;
    const apiBaseUrl = githubMatch
      ? `${originProtocol}://${githubMatch[1]}-8000.app.github.dev`
      : `${originProtocol}://${window.location.hostname}:${window.location.port === '3000' ? '8000' : window.location.port || '8000'}`;

    const fetchModelStatus = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/models/status`);
        const status = await response.json();
        setModelStatus(status);
      } catch {
        setModelStatus((prev) => prev ?? {
          llmReady: false,
          whisperReady: false,
          ttsReady: false,
          installing: false,
          progress: 0,
          message: 'Unable to reach model status endpoint.',
          error: 'Connection failed',
        });
      }
    };

    const startModelInstallation = async () => {
      if (installRequested) return;
      setInstallRequested(true);

      try {
        const response = await fetch(`${apiBaseUrl}/models/install`, { method: 'POST' });
        const data = await response.json();

        if (data.started) {
          setModelStatus((prev) => prev ? { ...prev, installing: true } : prev);
          await fetchModelStatus();
        } else {
          setModelStatus((prev) => prev ? { ...prev, message: data.message || prev.message } : prev);
        }
      } catch {
        setModelStatus((prev) => prev ? { ...prev, error: 'Failed to start model installation.' } : prev);
      }
    };

    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'get_device_code' }));
      void fetchModelStatus();
    });

    const statusTimer = window.setInterval(() => {
      void fetchModelStatus();
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
        <div className="absolute inset-x-0 top-4 z-20 px-3">
          <div className="rounded-3xl border border-cyan-400/20 bg-slate-950/95 p-4 text-sm text-slate-100 shadow-xl backdrop-blur-md">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">Local models needed</div>
                <div className="mt-1 text-base font-semibold text-white">Gemma is not fully ready yet.</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${modelStatus.installing ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
                  {modelStatus.installing ? 'Installing' : 'Needs install'}
                </span>
                {!modelStatus.installing && (
                  <button
                    type="button"
                    onClick={() => void startModelInstallation()}
                    className="rounded-full bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
                  >
                    Install models
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-300">
                <div className="font-semibold text-slate-100">LLM</div>
                <div>{modelStatus.llmReady ? 'Ready' : 'Missing'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-300">
                <div className="font-semibold text-slate-100">Speech</div>
                <div>{modelStatus.whisperReady ? 'Ready' : 'Missing'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-3 text-xs text-slate-300">
                <div className="font-semibold text-slate-100">TTS</div>
                <div>{modelStatus.ttsReady ? 'Ready' : 'Missing'}</div>
              </div>
            </div>

            <div className="mt-3 space-y-2 text-xs text-slate-300">
              <div>{modelStatus.message}</div>
              {modelStatus.error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-2 text-red-200">{modelStatus.error}</div>}
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${Math.min(100, Math.max(0, modelStatus.progress * 100))}%` }} />
              </div>
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
