import { useState, useEffect, useRef } from 'react'

/**
 * Hook that animates a number from its previous value to a new value.
 * Returns the interpolated display value.
 */
export function useAnimatedNumber(value: number, duration: number = 600): number {
  const [displayValue, setDisplayValue] = useState(value)
  const prevValueRef = useRef(value)
  const animFrameRef = useRef(0)

  useEffect(() => {
    const from = prevValueRef.current
    const to = value
    prevValueRef.current = value

    if (from === to) {
      setDisplayValue(to)
      return
    }

    const startTime = performance.now()

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased

      setDisplayValue(current)

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate)
      }
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [value, duration])

  return displayValue
}
