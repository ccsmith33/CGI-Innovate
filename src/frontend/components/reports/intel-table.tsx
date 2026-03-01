'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from './status-badge'
import { fetchReports, processAllPendingReports } from '@/lib/api'
import type { IntelReport } from '@/lib/types'
import { Loader2, AlertCircle, ChevronDown, ChevronRight, ShieldCheck, Cpu } from 'lucide-react'

const priorityStyles: Record<string, string> = {
  Routine: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  High: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Avengers Level Threat': 'bg-red-500/20 text-red-400 border-red-500/30',
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RedactedText({ text }: { text: string }) {
  const parts = text.split(/(\[REDACTED\])/g)
  return (
    <pre className="text-xs text-gray-300 bg-gray-950 p-3 rounded-md overflow-x-auto font-mono whitespace-pre-wrap break-words">
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

const severityColors: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
}

function parseEntities(
  raw: IntelReport['extracted_entities']
): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

function ExtractedEntitiesDisplay({
  entities,
}: {
  entities: IntelReport['extracted_entities']
}) {
  if (entities == null) {
    return (
      <p className="text-sm text-gray-500 italic" data-testid="entities-pending">
        Pending
      </p>
    )
  }

  const parsed = parseEntities(entities)

  if (!parsed) {
    // JSON parsing failed -- fall back to raw string
    return (
      <pre className="text-sm text-gray-300 bg-gray-900 p-3 rounded-md overflow-x-auto font-mono" data-testid="entities-raw">
        <code>{String(entities)}</code>
      </pre>
    )
  }

  const severity = typeof parsed.severity === 'string' ? parsed.severity : null
  const severityClass = severity
    ? severityColors[severity.toLowerCase()] ?? 'text-gray-300'
    : 'text-gray-300'

  const confidence =
    typeof parsed.confidence === 'number'
      ? `${Math.round(parsed.confidence * 100)}%`
      : null

  return (
    <div className="bg-gray-900 rounded-md p-3 space-y-2 text-sm" data-testid="entities-structured">
      <div className="flex gap-2">
        <span className="text-gray-500 w-28 shrink-0">Sector:</span>
        <span className="text-gray-300">{String(parsed.sector_id ?? '---')}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500 w-28 shrink-0">Resource Type:</span>
        <span className="text-gray-300">{String(parsed.resource_type ?? '---')}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500 w-28 shrink-0">Severity:</span>
        <span className={severityClass}>{severity ?? '---'}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500 w-28 shrink-0">Summary:</span>
        <span className="text-gray-300">{String(parsed.summary ?? '---')}</span>
      </div>
      {confidence && (
        <div className="flex gap-2">
          <span className="text-gray-500 w-28 shrink-0">Confidence:</span>
          <span className="text-gray-300">{confidence}</span>
        </div>
      )}
    </div>
  )
}

export function IntelTable() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [processedCount, setProcessedCount] = useState<number | null>(null)
  const hasTriggered = useRef(false)

  const {
    data: reportsData,
    error,
    isLoading,
    mutate,
  } = useSWR('reports', () => fetchReports({ limit: 200 }), { refreshInterval: 3000 })

  const reports: IntelReport[] = reportsData?.data ?? []

  // Auto-trigger LLM processing of pending reports on first load
  useEffect(() => {
    if (!hasTriggered.current && reports.length > 0) {
      const pendingCount = reports.filter((r) => r.status === 'pending').length
      if (pendingCount > 0) {
        hasTriggered.current = true
        processAllPendingReports()
          .then((res) => {
            setProcessedCount(res.queued)
            mutate()
          })
          .catch(() => {})
      }
    }
  }, [reports.length])

  async function handleManualProcess() {
    setProcessing(true)
    try {
      const res = await processAllPendingReports()
      setProcessedCount(res.queued)
      mutate()
    } finally {
      setProcessing(false)
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id)
  }

  if (isLoading) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="flex items-center justify-center py-16 gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load reports. Is the API running?</span>
        </CardContent>
      </Card>
    )
  }

  const pendingCount = reports.filter((r) => r.status === 'pending').length
  const processedReports = reports.filter((r) => r.status === 'processed').length

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            Intelligence Reports
          </CardTitle>
          <div className="flex items-center gap-3">
            {processedCount != null && (
              <span className="text-xs text-green-400">
                Queued {processedCount} reports for processing
              </span>
            )}
            <div className="flex gap-2 text-xs text-gray-500">
              <span className="text-green-400">{processedReports} processed</span>
              <span>·</span>
              <span className="text-yellow-400">{pendingCount} pending</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualProcess}
              disabled={processing || pendingCount === 0}
              className="border-gray-700 text-gray-400 hover:bg-gray-800 text-xs"
            >
              {processing ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Cpu className="w-3 h-3 mr-1" />
              )}
              Process Pending
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No intelligence reports yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400 w-8"></TableHead>
                  <TableHead className="text-gray-400">Time</TableHead>
                  <TableHead className="text-gray-400">Sector</TableHead>
                  <TableHead className="text-gray-400">Resource</TableHead>
                  <TableHead className="text-gray-400">Severity</TableHead>
                  <TableHead className="text-gray-400">Summary</TableHead>
                  <TableHead className="text-gray-400">Priority</TableHead>
                  <TableHead className="text-gray-400">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <>
                    <TableRow
                      key={report.report_id}
                      onClick={() => toggleExpand(report.report_id)}
                      className="border-gray-800 cursor-pointer hover:bg-gray-800/50 transition-colors"
                    >
                      <TableCell className="text-gray-500">
                        {expandedId === report.report_id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-gray-300 text-sm whitespace-nowrap">
                        {formatTime(report.created_at)}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {report.extracted_entities?.sector_id ?? '---'}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {report.extracted_entities?.resource_type ?? '---'}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {report.extracted_entities?.severity ?? '---'}
                      </TableCell>
                      <TableCell className="text-gray-300 max-w-xs truncate">
                        {report.extracted_entities?.summary ?? 'Awaiting processing...'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            priorityStyles[report.priority] ?? priorityStyles.Routine
                          }
                        >
                          {report.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={report.status} />
                          {report.priority === 'auto' && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                              data-testid="auto-alert-badge"
                            >
                              AUTO-ALERT
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === report.report_id && (
                      <TableRow
                        key={`${report.report_id}-detail`}
                        className="border-gray-800 hover:bg-transparent"
                      >
                        <TableCell colSpan={8} className="p-0">
                          <div className="p-4 bg-gray-800/50 space-y-4">
                            {/* Shield — redacted text */}
                            <div>
                              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-green-400" />
                                Shield-Protected Report Text
                                <span className="text-green-500 ml-1">(PII Redacted)</span>
                              </p>
                              <RedactedText text={report.redacted_text ?? ''} />
                            </div>

                            {/* Jarvis — extracted entities */}
                            <div>
                              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider flex items-center gap-1">
                                <Cpu className="w-3 h-3 text-blue-400" />
                                Jarvis Extracted Intelligence
                              </p>
                              <ExtractedEntitiesDisplay entities={report.extracted_entities} />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
