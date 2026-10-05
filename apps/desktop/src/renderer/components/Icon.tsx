import React from 'react'

const paths = {
  back: 'm14 6-6 6 6 6M8 12h12',
  branch: 'M6 7v10M6 12h7a5 5 0 0 0 5-5M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z',
  document: 'M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h6',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5m-6 6 6-6 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  link: 'm10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
} as const

export function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof paths; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export function TandemMark({ className = 'h-7 w-7' }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 8h13M12 8v16M18 24V8M18 24h8" /></svg>
}
