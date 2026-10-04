import React, { useMemo } from 'react'
import type { Branch, Message } from '@tandem/shared'

interface Props {
  branches: Branch[]
  /** All fetched messages keyed by branchId */
  allMessages: Map<string, Message[]>
  activeBranchId: string | null
  /** Branch IDs that have already had a summary shared to main */
  sharedBranchIds: Set<string>
  onSelectBranch: (branchId: string) => void
}

// ── Tree node produced by the layout pass ────────────────────────────────────

interface TreeNode {
  id: string        // unique per node (messageId or synthetic root)
  label: string
  branchId: string
  branchName: string
  /** pixel x/y centre of the circle */
  x: number
  y: number
  /** parent node id (for drawing connectors) */
  parentNodeId: string | null
  isForkPoint: boolean
  isActivePath: boolean
}

// ── Layout constants ──────────────────────────────────────────────────────────

const ROW_H = 28   // vertical gap between nodes
const COL_W = 32   // horizontal gap per branch depth level
const PAD_X = 16   // left padding
const PAD_Y = 14   // top padding
const R = 5        // circle radius

// ── Build the visual tree ─────────────────────────────────────────────────────

function buildTree(
  branches: Branch[],
  allMessages: Map<string, Message[]>,
  activeBranchId: string | null,
): { nodes: TreeNode[]; svgH: number; svgW: number } {
  const mainBranch = branches.find((b) => b.isMain)
  if (!mainBranch) return { nodes: [], svgH: 60, svgW: 120 }

  // Map from messageId → node for parent lookups
  const nodeById = new Map<string, TreeNode>()

  // Assign each branch a column depth (BFS from main)
  const branchDepth = new Map<string, number>()
  branchDepth.set(mainBranch.id, 0)
  // Sort non-main by createdAt so column assignment is stable
  const nonMain = branches
    .filter((b) => !b.isMain)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // Fetched lists are full root-to-head paths; the fork message's own branchId is the parent branch.
  const allFetched = [...allMessages.values()].flat()
  for (const b of nonMain) {
    const forkMsg = allFetched.find((m) => m.id === b.forkMessageId)
    const parentDepth = branchDepth.get(forkMsg?.branchId ?? mainBranch.id) ?? 0
    branchDepth.set(b.id, parentDepth + 1)
  }

  const nodes: TreeNode[] = []
  // row counter increments globally so all branches share the same Y axis
  let row = 0

  function addBranchNodes(branch: Branch, depth: number, parentForkNodeId: string | null) {
    // Only the branch's own messages: inherited history is drawn on its parent branch.
    const msgs = (allMessages.get(branch.id) ?? []).filter((m) => m.branchId === branch.id)
    const x = PAD_X + depth * COL_W

    // If this branch has no messages yet, draw a placeholder node
    if (msgs.length === 0) {
      const nodeId = `empty-${branch.id}`
      const y = PAD_Y + row * ROW_H
      row++
      const node: TreeNode = {
        id: nodeId,
        label: '…',
        branchId: branch.id,
        branchName: branch.name,
        x,
        y,
        parentNodeId: parentForkNodeId,
        isForkPoint: false,
        isActivePath: branch.id === activeBranchId,
      }
      nodes.push(node)
      nodeById.set(nodeId, node)
      return
    }

    let lastNodeId = parentForkNodeId

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]
      const nodeId = msg.id
      const y = PAD_Y + row * ROW_H
      row++

      // Determine if this message is a fork point (another branch's forkMessageId)
      const isForkPoint = nonMain.some((b2) => b2.forkMessageId === msg.id)

      const node: TreeNode = {
        id: nodeId,
        label: msg.authorType === 'assistant' ? 'AI' : msg.authorType === 'agent' ? 'AG' : 'U',
        branchId: branch.id,
        branchName: branch.name,
        x,
        y,
        parentNodeId: lastNodeId,
        isForkPoint,
        isActivePath: branch.id === activeBranchId,
      }
      nodes.push(node)
      nodeById.set(nodeId, node)
      lastNodeId = nodeId

      // After a fork point, recurse into child branches (those whose forkMessageId == msg.id)
      if (isForkPoint) {
        const childBranches = nonMain.filter((b2) => b2.forkMessageId === msg.id)
        for (const child of childBranches) {
          const childDepth = branchDepth.get(child.id) ?? depth + 1
          addBranchNodes(child, childDepth, nodeId)
        }
      }
    }
  }

  addBranchNodes(mainBranch, 0, null)

  // Also handle branches whose forkMessageId was not found in fetched messages
  // (e.g., messages not yet loaded) — add them at column 1 if not already placed
  const placedBranchIds = new Set(nodes.map((n) => n.branchId))
  for (const b of nonMain) {
    if (!placedBranchIds.has(b.id)) {
      const depth = branchDepth.get(b.id) ?? 1
      addBranchNodes(b, depth, null)
    }
  }

  const svgW = Math.max(120, PAD_X * 2 + (Math.max(...[...branchDepth.values()]) + 1) * COL_W)
  const svgH = Math.max(60, PAD_Y * 2 + row * ROW_H)

  return { nodes, svgH, svgW }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MessageTreePanel({ branches, allMessages, activeBranchId, sharedBranchIds, onSelectBranch }: Props) {
  const { nodes, svgH, svgW } = useMemo(
    () => buildTree(branches, allMessages, activeBranchId),
    [branches, allMessages, activeBranchId],
  )

  // Build a quick lookup for parent coordinates
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  if (branches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-gray-600">
        No branches
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2 shrink-0 border-b border-gray-800">
        Tree
      </p>
      <div className="flex-1 overflow-auto">
        <svg
          width={svgW}
          height={svgH}
          className="block"
          aria-label="Message tree"
        >
          {/* Connector lines */}
          {nodes.map((node) => {
            if (!node.parentNodeId) return null
            const parent = nodeMap.get(node.parentNodeId)
            if (!parent) return null
            const isActive = node.isActivePath && parent.isActivePath
            return (
              <line
                key={`line-${node.id}`}
                x1={parent.x}
                y1={parent.y}
                x2={node.x}
                y2={node.y}
                stroke={isActive ? '#3b82f6' : '#374151'}
                strokeWidth={isActive ? 1.5 : 1}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const isActive = node.branchId === activeBranchId
            const isShared = sharedBranchIds.has(node.branchId)
            const circleColor = isActive
              ? '#3b82f6'
              : node.isForkPoint
              ? '#7c5cd8'
              : '#4b5563'
            const textColor = isActive ? '#fff' : '#9ca3af'

            return (
              <g
                key={node.id}
                onClick={() => onSelectBranch(node.branchId)}
                style={{ cursor: 'pointer' }}
                aria-label={`${node.branchName}: ${node.label}`}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={R}
                  fill={circleColor}
                />
                <text
                  x={node.x + R + 4}
                  y={node.y + 4}
                  fontSize={9}
                  fill={textColor}
                  style={{ userSelect: 'none' }}
                >
                  {node.label}
                </text>
                {/* Shared indicator — small dot above the circle */}
                {isShared && (
                  <circle
                    cx={node.x + R - 1}
                    cy={node.y - R + 1}
                    r={2.5}
                    fill="#60a5fa"
                    aria-label="shared to main"
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
