'use client'

import { useState } from 'react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from './status-badge'
import { fetchReports } from '@/lib/api'
import type { IntelReport } from '@/lib/types'
import { Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'

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

export function IntelTable() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const {
    data: reportsData,
    error,
    isLoading,
  } = useSWR('reports', () => fetchReports(), { refreshInterval: 3000 })

  const reports: IntelReport[] = reportsData?.data ?? []

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

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white text-lg">Intelligence Reports</CardTitle>
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
                        <StatusBadge status={report.status} />
                      </TableCell>
                    </TableRow>
                    {expandedId === report.report_id && (
                      <TableRow
                        key={`${report.report_id}-detail`}
                        className="border-gray-800 hover:bg-transparent"
                      >
                        <TableCell colSpan={8} className="p-0">
                          <div className="p-4 bg-gray-800/50">
                            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
                              Extracted Intelligence
                            </p>
                            {report.extracted_entities ? (
                              <pre className="text-sm text-gray-300 bg-gray-900 p-3 rounded-md overflow-x-auto font-mono">
                                <code>
                                  {JSON.stringify(
                                    report.extracted_entities,
                                    null,
                                    2
                                  )}
                                </code>
                              </pre>
                            ) : (
                              <p className="text-sm text-gray-500 italic">
                                No extracted data yet.
                              </p>
                            )}
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
