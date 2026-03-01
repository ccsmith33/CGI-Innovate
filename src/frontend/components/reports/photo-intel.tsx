'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { analyzeImage, type ImageAnalysis } from '@/lib/api'
import { Camera, Loader2, Upload, AlertTriangle } from 'lucide-react'

const severityStyles: Record<string, string> = {
  LOW: 'bg-green-500/20 text-green-400 border-green-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
}

export function PhotoIntel() {
  const [dragOver, setDragOver] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<ImageAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const resp = await analyzeImage(file)
      setResult(resp.analysis)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      handleFile(file)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <Card className="bg-gray-900 border-gray-800" data-testid="photo-intel">
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Camera className="w-5 h-5 text-blue-400" />
          Visual Intelligence Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            dragOver
              ? 'border-blue-400 bg-blue-500/10'
              : 'border-gray-700 hover:border-gray-600'
          }`}
          data-testid="photo-dropzone"
        >
          <label className="cursor-pointer flex flex-col items-center gap-2">
            {analyzing ? (
              <>
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                <span className="text-sm text-blue-400">JARVIS analyzing...</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-500" />
                <span className="text-sm text-gray-400">
                  Drop an image here or click to upload
                </span>
                <span className="text-xs text-gray-600">
                  Supports JPG, PNG, WebP
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleInputChange}
              className="hidden"
              data-testid="photo-input"
            />
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm" data-testid="photo-error">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Result card */}
        {result && (
          <div
            className="bg-gray-950 border border-gray-800 rounded-lg p-4 space-y-3"
            data-testid="photo-result"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                Analysis Result
              </span>
              <Badge
                variant="outline"
                className={severityStyles[result.severity] ?? severityStyles.MEDIUM}
              >
                {result.severity}
              </Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Threat Type:</span>
                <span className="text-gray-300">{result.threat_type}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Affected Sector:</span>
                <span className="text-gray-300">{result.affected_sector}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Resources at Risk:</span>
                <span className="text-gray-300">{result.resources_at_risk.join(', ')}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Summary:</span>
                <span className="text-gray-300">{result.summary}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Action:</span>
                <span className="text-yellow-400">{result.recommended_action}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
