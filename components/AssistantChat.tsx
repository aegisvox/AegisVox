'use client'

import React, { useEffect, useRef, useState } from 'react';

type SkillCanvasState = {
  active: boolean;
  name: string;
  text?: string;
  data?: Record<string, unknown> | null;
};

export default function AssistantChat() {
  const [inputText, setInputText] = useState('');
  const [skillCanvas, setSkillCanvas] = useState<SkillCanvasState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const githubMatch = window.location.host.match(/^(.*)-3000\.app\.github\.dev$/);
    const socketUrl = githubMatch
      ? `${protocol}://${githubMatch[1]}-8000.app.github.dev/ws/live`
      : `${protocol}://${window.location.hostname}:${window.location.port === '3000' ? '8000' : window.location.port || '8000'}/ws/live`;
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

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

        if (message.type === 'skill_start') {
          setSkillCanvas({ active: true, name: message.name, text: `Opening ${message.name}...` });
          return;
        }

        if (message.type === 'skill_end') {
          const rawOutput = message.output;
          const parsedOutput = typeof rawOutput === 'string' ? parseSafeJson(rawOutput) ?? rawOutput : rawOutput;

          if (parsedOutput && typeof parsedOutput === 'object' && 'data' in parsedOutput) {
            setSkillCanvas({ active: true, name: message.name, data: (parsedOutput as any).data as Record<string, unknown> });
          } else {
            setSkillCanvas({
              active: true,
              name: message.name,
              text: typeof parsedOutput === 'string' ? parsedOutput : JSON.stringify(parsedOutput, null, 2),
            });
          }
        }
      } catch {
        // Ignore malformed socket payloads.
      }
    });

    return () => {
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!inputText.trim()) return;
      sendPrompt(inputText.trim());
      setInputText('');
    }
  };

  const mapUrl = skillCanvas?.data?.map_url as string | undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {skillCanvas?.active && (
        <div className="absolute inset-0 z-0 overflow-hidden bg-black/90">
          {mapUrl ? (
            <iframe
              src={mapUrl}
              title={skillCanvas.name}
              className="h-full w-full border-0"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-white">
              <div className="max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-white shadow-[0_0_60px_rgba(56,189,248,0.12)]">
                <div className="mb-4 text-lg font-semibold">{skillCanvas.name}</div>
                <pre className="whitespace-pre-wrap break-words text-sm text-slate-200">
                  {skillCanvas.text ?? 'Displaying skill output on screen.'}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative z-10 flex h-screen items-end justify-center px-0 pb-10">
        <div className="relative w-full px-5 py-4">
          <div className="absolute inset-x-0 -top-[1px] h-[calc(100%+3px)] rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute inset-x-0 -top-[1px] h-[calc(100%+3px)] rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative mx-auto w-full max-w-5xl">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              className="w-full bg-[#111217] rounded-full px-6 py-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-transparent focus:ring-0 transition"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
