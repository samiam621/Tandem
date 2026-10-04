import React, { useEffect, useRef } from 'react'
import type { User, SessionAgent } from '@tandem/shared'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MentionItem {
  /** The string that will be inserted after @ */
  label: string
  sublabel: string   // owner name for agents, kind for members
  isAgent: boolean
  isActive: boolean  // agent recently used
}

// ── Helper: build the merged mentionables list ────────────────────────────────

export function buildMentionItems(members: User[], agents: SessionAgent[]): MentionItem[] {
  const agentLabels = new Set(agents.map((a) => a.label.toLowerCase()))

  const memberItems: MentionItem[] = members
    .filter((m) => m.kind !== 'agent') // agent-kind members are covered by the agents list
    .map((m) => ({
      label: m.displayName,
      sublabel: m.kind,
      isAgent: false,
      isActive: false,
    }))

  const agentItems: MentionItem[] = agents.map((a) => ({
    label: a.label,
    sublabel: `via ${a.ownerName}`,
    isAgent: true,
    isActive: a.active,
  }))

  // Members whose display name exactly matches an agent label are shown via the agent entry
  const filteredMembers = memberItems.filter(
    (m) => !agentLabels.has(m.label.toLowerCase()),
  )

  return [...filteredMembers, ...agentItems]
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  items: MentionItem[]
  /** The partial text typed after "@" — used to filter */
  query: string
  activeIndex: number
  onSelect: (label: string) => void
  onActiveIndexChange: (index: number) => void
  onClose: () => void
}

export function MentionMenu({
  items,
  query,
  activeIndex,
  onSelect,
  onActiveIndexChange,
  onClose,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = items.filter((item) =>
    item.label.toLowerCase().startsWith(query.toLowerCase()),
  )

  // Scroll the highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (filtered.length === 0) return null

  return (
    <div
      className="absolute bottom-full mb-1 left-0 z-50 w-64 rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden"
      onMouseDown={(e) => e.preventDefault()} // prevent input blur
    >
      <ul ref={listRef} className="max-h-48 overflow-y-auto py-1" role="listbox">
        {filtered.map((item, i) => (
          <li
            key={item.label}
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => onActiveIndexChange(i)}
            onClick={() => onSelect(item.label)}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none ${
              i === activeIndex ? 'bg-gray-700' : 'hover:bg-gray-800'
            }`}
          >
            {/* Avatar / icon */}
            <span
              className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                item.isAgent ? 'bg-teal-800 text-teal-200' : 'bg-gray-600 text-gray-200'
              }`}
            >
              {item.isAgent ? '⚙' : item.label[0]?.toUpperCase() ?? '?'}
            </span>

            {/* Label + sublabel */}
            <span className="flex-1 min-w-0">
              <span className="text-sm text-white">{item.label}</span>
              <span className="ml-1.5 text-xs text-gray-500">{item.sublabel}</span>
            </span>

            {/* Active dot for agents */}
            {item.isAgent && item.isActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" title="recently active" />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Highlight @mentions in plain text ─────────────────────────────────────────

/**
 * Splits `text` into alternating plain / mention segments and wraps matched
 * @tokens in a highlight span. `knownLabels` is the set of valid label strings
 * (case-insensitive).
 */
export function highlightMentions(text: string, knownLabels: Set<string>): React.ReactNode {
  // Split on @word boundaries; keep the delimiters
  const parts = text.split(/(@\S+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const candidate = part.slice(1)
      if (knownLabels.has(candidate.toLowerCase())) {
        return (
          <span key={i} className="text-teal-400 font-medium">
            {part}
          </span>
        )
      }
    }
    return part
  })
}
