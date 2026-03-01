'use client'

export default function PresentationPage() {
  return (
    <div className="w-full h-screen">
      <iframe
        src="/slides.html"
        className="w-full h-full border-0"
        title="Project Sentinel — Technical Presentation"
        allowFullScreen
      />
    </div>
  )
}
