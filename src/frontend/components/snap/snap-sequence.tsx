'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

interface SnapSequenceProps {
  active: boolean
  onComplete: () => void
}

export function SnapSequence({ active, onComplete }: SnapSequenceProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const blastRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const crtRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<gsap.core.Timeline | null>(null)

  useEffect(() => {
    if (!active) return

    const tl = gsap.timeline({
      onComplete: () => {
        document.body.style.overflow = ''
        document.documentElement.style.overflow = ''
        onComplete()
      },
    })
    timelineRef.current = tl

    // 0. Lock overflow before shake to prevent scrollbar flicker
    tl.add(() => {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    })

    // 1. Camera shake (shake the entire page container)
    tl.to('.dashboard-root', {
      x: 'random(-8, 8)',
      y: 'random(-8, 8)',
      duration: 0.05,
      repeat: 4,
      yoyo: true,
      ease: 'none',
    })

    // 2. Purple blast wave
    if (blastRef.current) {
      tl.fromTo(
        blastRef.current,
        { scale: 0, opacity: 1 },
        { scale: 20, opacity: 0, duration: 0.6, ease: 'power2.out' },
        '-=0.1'
      )
    }

    // 3. Full-screen purple tint
    if (overlayRef.current) {
      tl.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 0.4, duration: 0.2 },
        '-=0.5'
      )
      tl.to(overlayRef.current, { opacity: 0, duration: 0.6 })
    }

    // 4. CRT glitch flash
    if (crtRef.current) {
      tl.fromTo(
        crtRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.08, repeat: 3, yoyo: true },
        '-=0.5'
      )
    }

    // 5. Web Audio bass drop
    tl.add(() => {
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.setValueAtTime(80, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 1.0)
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0)
        osc.start()
        osc.stop(ctx.currentTime + 1.0)
      } catch {
        // AudioContext not available in some environments
      }
    }, '-=1.0')

    // 6. JARVIS RECALIBRATING typewriter
    if (textRef.current) {
      const textEl = textRef.current
      tl.set(textEl, { opacity: 1 }, '+=0.1')
      const chars = 'JARVIS RECALIBRATING...'
      tl.to(textEl, {
        duration: chars.length * 0.03,
        onUpdate: function () {
          const progress = this.progress()
          const charCount = Math.floor(progress * chars.length)
          textEl.textContent =
            chars.slice(0, charCount) + (charCount < chars.length ? '\u2588' : '')
        },
      })
      tl.to(textEl, { opacity: 0, duration: 0.3, delay: 0.3 })
    }

    // 7. Trigger JARVIS voice alert
    tl.add(() => {
      window.dispatchEvent(
        new CustomEvent('jarvis-alert', {
          detail: {
            message:
              'Commander. Thanos-level anomaly detected. All resource projections are being recalculated. Initiating emergency protocols.',
          },
        })
      )
    }, '-=1.0')

    return () => {
      tl.kill()
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [active, onComplete])

  if (!active) return null

  return (
    <div data-testid="snap-sequence">
      <div
        ref={overlayRef}
        className="snap-overlay"
        style={{ background: 'purple' }}
      />
      <div ref={blastRef} className="snap-blast-ring" />
      <div ref={crtRef} className="snap-crt" />
      <div
        ref={textRef}
        className="snap-text font-mono text-2xl text-purple-400"
        data-testid="snap-text"
      />
    </div>
  )
}
