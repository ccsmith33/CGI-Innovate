'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Radio, Shield } from 'lucide-react'

const nav = [
  { href: '/dashboard', label: 'Analytics', icon: BarChart3 },
  { href: '/reports', label: 'Field Intel', icon: Radio },
]

export function Sidebar() {
  const path = usePathname()

  return (
    <aside className="w-56 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col p-4">
      <div className="flex items-center gap-2 mb-8">
        <Shield className="w-6 h-6 text-blue-400" />
        <span className="font-bold text-lg text-white">SENTINEL</span>
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
              ${
                path === href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
