'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ResourceChart } from '@/components/charts/resource-chart'
import { ForecastOverlay } from '@/components/charts/forecast-overlay'
import { SectorSummary } from '@/components/charts/sector-summary'
import {
  fetchResources,
  fetchSectors,
  fetchResourceTypes,
  fetchSummary,
  fetchForecasts,
} from '@/lib/api'
import type { ResourceLog, SummaryItem, Forecast } from '@/lib/types'
import { Loader2, AlertCircle } from 'lucide-react'

const ALL = '__all__'

export default function DashboardPage() {
  const [selectedSector, setSelectedSector] = useState<string>(ALL)
  const [selectedResource, setSelectedResource] = useState<string>(ALL)

  const { data: sectorsData } = useSWR('sectors', fetchSectors)
  const { data: typesData } = useSWR('types', fetchResourceTypes)

  const resourceParams: Record<string, string> = { limit: '500' }
  if (selectedSector !== ALL) resourceParams.sector = selectedSector
  if (selectedResource !== ALL) resourceParams.resource_type = selectedResource
  const resourceKey = `resources-${selectedSector}-${selectedResource}`

  const {
    data: resourcesData,
    error: resourcesError,
    isLoading: resourcesLoading,
  } = useSWR(resourceKey, () => fetchResources(resourceParams), {
    refreshInterval: 5000,
  })

  const {
    data: summaryData,
    error: summaryError,
    isLoading: summaryLoading,
  } = useSWR('summary', fetchSummary, { refreshInterval: 5000 })

  const { data: forecastsData } = useSWR('forecasts', fetchForecasts, {
    refreshInterval: 30000,
  })

  const sectors: string[] = sectorsData?.sectors ?? []
  const resourceTypes: string[] = typesData?.resource_types ?? []
  const resources: ResourceLog[] = resourcesData?.data ?? []
  const summary: SummaryItem[] = summaryData?.data ?? []
  const forecasts: Forecast[] = forecastsData?.data ?? []

  const activeSector = selectedSector !== ALL ? selectedSector : null
  const activeResource = selectedResource !== ALL ? selectedResource : null

  const matchingForecast =
    activeSector && activeResource
      ? forecasts.find(
          (f) => f.sector_id === activeSector && f.resource_type === activeResource
        ) ?? null
      : null

  function clearFilters() {
    setSelectedSector(ALL)
    setSelectedResource(ALL)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Analytics Dashboard</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedSector} onValueChange={setSelectedSector}>
            <SelectTrigger className="w-44 bg-gray-900 border-gray-700 text-gray-100">
              <SelectValue placeholder="All Sectors" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
              <SelectItem value={ALL}>All Sectors</SelectItem>
              {sectors.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedResource} onValueChange={setSelectedResource}>
            <SelectTrigger className="w-48 bg-gray-900 border-gray-700 text-gray-100">
              <SelectValue placeholder="All Resources" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700">
              <SelectItem value={ALL}>All Resources</SelectItem>
              {resourceTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={clearFilters}
            className="border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Resource Chart */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">
            Resource Stock Levels
            {activeSector && (
              <span className="text-blue-400 ml-2 text-sm font-normal">
                Sector: {activeSector}
              </span>
            )}
            {activeResource && (
              <span className="text-purple-400 ml-2 text-sm font-normal">
                Resource: {activeResource}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resourcesLoading ? (
            <div className="flex items-center justify-center h-80">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : resourcesError ? (
            <div className="flex items-center justify-center h-80 gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load resource data. Is the API running?</span>
            </div>
          ) : (
            <>
              <ResourceChart
                data={resources}
                forecast={matchingForecast}
                sector={activeSector}
                resource={activeResource}
              />
              <ForecastOverlay forecast={matchingForecast} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Sector Summary */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">
            Sector Stock Summary
            {activeResource && (
              <span className="text-purple-400 ml-2 text-sm font-normal">
                {activeResource}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : summaryError ? (
            <div className="flex items-center justify-center h-64 gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load summary data.</span>
            </div>
          ) : (
            <SectorSummary data={summary} selectedResource={activeResource} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
