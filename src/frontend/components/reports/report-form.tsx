'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from './status-badge'
import { submitReport, fetchRedactionPreview } from '@/lib/api'
import type { RedactionPreview } from '@/lib/types'
import { Loader2, Send, ShieldCheck } from 'lucide-react'

function RedactedPreviewText({ text }: { text: string }) {
  const parts = text.split(/(\[REDACTED\])/g)
  return (
    <pre className="text-xs text-gray-300 bg-gray-950 p-3 rounded-md overflow-x-auto font-mono whitespace-pre-wrap break-words min-h-[120px]">
      {parts.map((part, i) =>
        part === '[REDACTED]' ? (
          <span key={i} className="bg-red-900/40 text-red-400 px-1 rounded font-bold">
            [REDACTED]
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </pre>
  )
}

export function ReportForm() {
  const [rawText, setRawText] = useState('')
  const [heroAlias, setHeroAlias] = useState('')
  const [secureContact, setSecureContact] = useState('')
  const [priority, setPriority] = useState('Routine')
  const [loading, setLoading] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [preview, setPreview] = useState<RedactionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPreview = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!text.trim()) {
      setPreview(null)
      setPreviewLoading(false)
      return
    }

    setPreviewLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await fetchRedactionPreview(text)
        setPreview(result)
      } catch {
        // Preview is best-effort; don't block the form
      } finally {
        setPreviewLoading(false)
      }
    }, 300)
  }, [])

  useEffect(() => {
    fetchPreview(rawText)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [rawText, fetchPreview])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSubmittedId(null)

    try {
      const result = await submitReport({
        raw_text: rawText,
        metadata: {
          hero_alias: heroAlias || undefined,
          secure_contact: secureContact || undefined,
        },
        priority,
      })
      setSubmittedId(result.report_id)
      setRawText('')
      setHeroAlias('')
      setSecureContact('')
      setPriority('Routine')
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white text-lg">Submit Field Report</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left pane: raw text input */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Raw Report Text
              </label>
              <Textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Describe the situation..."
                className="bg-gray-800 border-gray-700 text-gray-100 min-h-[120px] placeholder:text-gray-500"
                required
                data-testid="report-textarea"
              />
            </div>

            {/* Right pane: redacted preview */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-green-400" />
                Redaction Preview
              </label>
              {previewLoading ? (
                <div className="flex items-center justify-center min-h-[120px] bg-gray-950 rounded-md border border-gray-700">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                </div>
              ) : preview ? (
                <div>
                  <RedactedPreviewText text={preview.redacted} />
                  <p className="text-xs text-gray-500 mt-1" data-testid="redaction-count">
                    {(preview.patterns_matched ?? []).length} item{(preview.patterns_matched ?? []).length !== 1 ? 's' : ''} redacted
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center min-h-[120px] bg-gray-950 rounded-md border border-gray-700 text-gray-600 text-sm">
                  Start typing to see redaction preview
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Hero Alias{' '}
              <span className="text-gray-500 text-xs">(will be redacted)</span>
            </label>
            <Input
              value={heroAlias}
              onChange={(e) => setHeroAlias(e.target.value)}
              placeholder="e.g., Tony Stark"
              className="bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Secure Contact{' '}
              <span className="text-gray-500 text-xs">(will be redacted)</span>
            </label>
            <Input
              value={secureContact}
              onChange={(e) => setSecureContact(e.target.value)}
              placeholder="e.g., 555-0101"
              className="bg-gray-800 border-gray-700 text-gray-100 placeholder:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Priority
            </label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-gray-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700">
                <SelectItem value="Routine">Routine</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Avengers Level Threat">
                  Avengers Level Threat
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="submit"
            disabled={loading || !rawText.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Report
              </>
            )}
          </Button>
        </form>

        {submittedId && (
          <div className="mt-4 p-3 bg-gray-800 rounded-md border border-gray-700">
            <p className="text-sm text-gray-300">
              Report submitted:{' '}
              <span className="text-blue-400 font-mono text-xs">{submittedId}</span>
            </p>
            <div className="mt-1">
              <StatusBadge status="processing" />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-500/10 rounded-md border border-red-500/30">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
