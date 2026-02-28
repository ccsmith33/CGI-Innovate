'use client'

import { ReportForm } from '@/components/reports/report-form'
import { IntelTable } from '@/components/reports/intel-table'

export default function ReportsPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Field Intel</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ReportForm />
        </div>
        <div className="lg:col-span-2">
          <IntelTable />
        </div>
      </div>
    </div>
  )
}
