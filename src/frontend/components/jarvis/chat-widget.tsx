'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, X, Minimize2, Cpu } from 'lucide-react'
import { sendJarvisMessage } from '@/lib/api'
import type { ChatMessage, JarvisChatResponse } from '@/lib/types'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  functionCalls?: string[]
}

const STARTER_PROMPTS = [
  'Which sector runs out first?',
  'Any anomalies detected?',
  'Summarize latest intel reports',
  'Compare forecast models for Wakanda',
]

const FUNCTION_ICONS: Record<string, string> = {
  get_all_forecasts: '\u{1F4CA}',
  get_resource_summary: '\u{1F4E6}',
  get_anomalies: '\u{1F50D}',
  get_intel_reports: '\u{1F4C4}',
  get_redaction_log: '\u{1F6E1}\uFE0F',
  get_forecast_comparison: '\u{1F4C8}',
  get_resource_history: '\u{1F4C5}',
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isLoading, scrollToBottom])

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0)
      inputRef.current?.focus()
    }
  }, [isOpen])

  async function handleSend(text?: string) {
    const messageText = text ?? input.trim()
    if (!messageText || isLoading) return

    const userMessage: DisplayMessage = { role: 'user', content: messageText }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const response: JarvisChatResponse = await sendJarvisMessage(messageText, history)
      const assistantMessage: DisplayMessage = {
        role: 'assistant',
        content: response.reply,
        functionCalls: response.function_calls_made,
      }
      setMessages((prev) => [...prev, assistantMessage])
      if (!isOpen) {
        setUnreadCount((prev) => prev + 1)
      }
    } catch {
      const errorMessage: DisplayMessage = {
        role: 'assistant',
        content: 'Connection to JARVIS failed. Please check if the API is running.',
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* Expanded Chat Panel */}
      {isOpen && (
        <div
          data-testid="jarvis-panel"
          className="fixed bottom-20 right-6 w-80 h-[480px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-green-400" />
              <div>
                <h3 className="text-sm font-bold text-white leading-none">JARVIS</h3>
                <p className="text-xs text-gray-400">Command Intelligence</p>
              </div>
            </div>
            <button
              data-testid="jarvis-minimize"
              onClick={() => setIsOpen(false)}
              className="p-1 text-gray-400 hover:text-white transition-colors rounded"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && !isLoading && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 text-center mb-3">
                  Ask JARVIS about sectors, resources, forecasts, or intel.
                </p>
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    data-testid="starter-prompt"
                    onClick={() => handleSend(prompt)}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors border border-gray-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] space-y-1`}>
                  <div
                    className={`px-3 py-2 rounded-lg text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-200 font-mono text-xs leading-relaxed'
                    }`}
                  >
                    {msg.content}
                  </div>
                  {msg.functionCalls && msg.functionCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.functionCalls.map((fn, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-[10px] text-gray-400"
                        >
                          {FUNCTION_ICONS[fn] ?? '\u{2699}\uFE0F'} {fn}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 px-3 py-2 rounded-lg">
                  <div data-testid="typing-indicator" className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 border-t border-gray-700 bg-gray-800">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                data-testid="jarvis-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask JARVIS..."
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors"
                disabled={isLoading}
              />
              <button
                data-testid="jarvis-send"
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
                className="p-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        data-testid="jarvis-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gray-800 hover:bg-gray-700 border-2 border-green-500 rounded-full shadow-lg flex items-center justify-center z-50 transition-all group"
      >
        {isOpen ? (
          <X className="w-6 h-6 text-green-400" />
        ) : (
          <>
            <Cpu className="w-6 h-6 text-green-400 group-hover:scale-110 transition-transform" />
            {/* Pulse animation */}
            <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-20" />
          </>
        )}
        {!isOpen && unreadCount > 0 && (
          <span
            data-testid="jarvis-unread"
            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center"
          >
            {unreadCount}
          </span>
        )}
      </button>
    </>
  )
}
