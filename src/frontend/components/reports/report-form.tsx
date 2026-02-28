'use client'

import { useState } from 'react'
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
import { submitReport } from '@/lib/api'
import { Loader2, Send } from 'lucide-react'

export function ReportForm() {
  const [rawText, setRawText] = useState('')
  const [heroAlias, setHeroAlias] = useState('')
  const [secureContact, setSecureContact] = useState('')
  const [priority, setPriority] = useState('Routine')
  const [loading, setLoading] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
            />
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
