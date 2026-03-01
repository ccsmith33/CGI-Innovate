'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchRedactionLog } from '@/lib/api'
import type { RedactionLogItem } from '@/lib/types'
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZE = 20

const patternColors: Record<string, string> = {
  HERO_NAME: 'bg-red-500/20 text-red-400 border-red-500/30',
  PHONE_NUMBER: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  EMAIL: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  SSN: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  ADDRESS: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  CREDIT_CARD: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
}

function getPatternBadgeClass(pattern: string): string {
  return patternColors[pattern] ?? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function truncateUUID(uuid: string): string {
  return uuid.slice(0, 8)
}

export default function SecurityPage() {
  const [page, setPage] = useState(1)

  const {
    data,
    error,
    isLoading,
  } = useSWR(
    ['redaction-log', page],
    () => fetchRedactionLog({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    { refreshInterval: 10000 }
  )

  const items: RedactionLogItem[] = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const totalPIIInstances = items.reduce(
    (sum, item) => sum + item.patterns_matched.length,
    0
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-green-400" />
          Security Operations
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          PII Redaction Audit Log — Privacy by Design
        </p>
      </div>

      {/* Summary stat bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="stat-bar">
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Reports Processed</p>
            <p className="text-2xl font-bold text-white mt-1" data-testid="stat-total-reports">{total}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="py-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">PII Instances Redacted</p>
            <p className="text-2xl font-bold text-white mt-1" data-testid="stat-pii-instances">{totalPIIInstances}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <p className="text-sm text-green-400 font-medium">
                All data sanitized before LLM transmission
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Redaction log table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-400" />
            Redaction Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load redaction log. Is the API running?</span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              No redaction records yet.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-400">Report ID</TableHead>
                      <TableHead className="text-gray-400">Timestamp</TableHead>
                      <TableHead className="text-gray-400">Original Length</TableHead>
                      <TableHead className="text-gray-400">Redacted Length</TableHead>
                      <TableHead className="text-gray-400">Data Removed</TableHead>
                      <TableHead className="text-gray-400">Patterns Matched</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const originalLen = item.original_text_hash.length
                      const redactedLen = item.redacted_text.length
                      const removed = originalLen - redactedLen
                      return (
                        <TableRow
                          key={item.id}
                          className="border-gray-800 hover:bg-gray-800/50 transition-colors"
                        >
                          <TableCell className="font-mono text-sm text-gray-300">
                            {truncateUUID(item.report_id)}
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm whitespace-nowrap">
                            {formatTimestamp(item.redacted_at)}
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm">
                            {originalLen} chars
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm">
                            {redactedLen} chars
                          </TableCell>
                          <TableCell className="text-sm">
                            <span className="text-amber-400 font-medium">
                              -{Math.abs(removed)} chars
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {item.patterns_matched.map((pattern, i) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className={`text-xs ${getPatternBadgeClass(pattern)}`}
                                >
                                  {pattern}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              <div className="flex items-center justify-between mt-4" data-testid="pagination">
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages} ({total} records)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="border-gray-700 text-gray-400 hover:bg-gray-800"
                    data-testid="prev-page"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="border-gray-700 text-gray-400 hover:bg-gray-800"
                    data-testid="next-page"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
