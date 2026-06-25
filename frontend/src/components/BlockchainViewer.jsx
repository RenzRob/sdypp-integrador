import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Hash, Clock, Database, Link2, Circle } from 'lucide-react'

function formatTimestamp(ts) {
  if (!ts) return '-'
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts)
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function shortHash(hash) {
  if (!hash) return '—'
  return hash.slice(0, 14) + '…'
}

function BlockEntry({ block, isLast }) {
  const [expanded, setExpanded] = useState(false)
  const isGenesis = block.index === 0
  const txns = block.transactions || block.data || []

  return (
    <div className="relative flex flex-col">
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isGenesis
              ? 'bg-gradient-to-br from-[#6c63ff] to-[#8b5cf6] shadow-[0_0_16px_rgba(108,99,255,0.2)]'
              : 'bg-white/[0.04] border border-white/[0.06]'
          }`}>
            <Circle className={`w-3 h-3 ${isGenesis ? 'text-white' : 'text-[#71717a]'}`} />
          </div>
          {!isLast && <div className="w-px flex-1 bg-gradient-to-b from-[#6c63ff]/30 to-white/[0.04] min-h-[24px]" />}
        </div>

        <div className={`flex-1 min-w-0 mb-4 rounded-xl border transition-all duration-200 cursor-pointer ${
          expanded ? 'border-[#6c63ff]/30 shadow-[0_0_20px_rgba(108,99,255,0.05)]' : 'border-white/[0.06] hover:border-white/[0.12]'
        }`} style={{ background: 'var(--surface)' }}
        onClick={() => setExpanded(e => !e)}
        title="Click para ver transacciones"
        >
          <div className="p-3.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className={`text-xs font-bold flex items-center gap-1.5 ${isGenesis ? 'text-[#6c63ff]' : 'text-[#a1a1aa]'}`}>
                <Layers className="w-3.5 h-3.5" />
                {isGenesis ? 'BLOQUE GENESIS' : `BLOQUE #${block.index}`}
              </span>
              <span className="font-mono text-[10px] text-[#71717a] tracking-wider truncate max-w-[120px] flex items-center gap-1">
                <Hash className="w-3 h-3 flex-shrink-0" />
                {shortHash(block.hash || block.block_hash)}
              </span>
            </div>

            <div className="flex items-center justify-between text-[10px] text-[#71717a]">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTimestamp(block.timestamp)}</span>
              <span className="flex items-center gap-1"><Link2 className="w-3 h-3" />prev: {shortHash(block.previous_hash || block.prev_hash)}</span>
            </div>

            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.06]">
              <span className="text-[10px] text-success flex items-center gap-1">
                <Database className="w-3 h-3" />{txns.length} txn{txns.length !== 1 ? 's' : ''}
              </span>
              <span className="text-[10px] text-[#71717a] flex items-center gap-0.5">
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {expanded ? 'ocultar' : 'detalle'}
              </span>
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1.5">
                {txns.length > 0 ? txns.map((txn, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[10px] text-[#71717a] font-mono break-all">
                    {typeof txn === 'string' ? txn : JSON.stringify(txn, null, 0).slice(0, 180)}
                  </div>
                )) : (
                  <div className="p-2 rounded-lg bg-white/[0.02] text-[10px] text-[#71717a]">Sin transacciones</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BlockchainViewer({ blocks = [] }) {
  if (!blocks || blocks.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-[#f4f4f5] flex items-center gap-2 mb-5">
          <Layers className="w-4 h-4 text-[#6c63ff]" /> Blockchain
        </h2>
        <div className="flex flex-col items-center justify-center py-12 text-[#71717a]">
          <Layers className="w-12 h-12 mb-3 text-white/[0.06]" />
          <p className="text-xs">No hay bloques registrados aún</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-[#f4f4f5] flex items-center gap-2 mb-1">
        <Layers className="w-4 h-4 text-[#6c63ff]" /> Blockchain
      </h2>
      <p className="text-[10px] text-[#71717a] mb-5">
        {blocks.length} bloque{blocks.length !== 1 ? 's' : ''} — click para ver detalle
      </p>
      <div className="space-y-0">
        {blocks.map((block, i) => (
          <BlockEntry key={block.index ?? i} block={block} isLast={i === blocks.length - 1} />
        ))}
      </div>
    </div>
  )
}
