import React, { useState } from 'react'

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
  return hash.slice(0, 16) + '…'
}

function BlockEntry({ block, isLast }) {
  const [expanded, setExpanded] = useState(false)
  const isGenesis = block.index === 0

  const txns = block.transactions || block.data || []

  return (
    <div className="blockchain-block-wrapper">
      <div
        className={`blockchain-block${isGenesis ? ' genesis' : ''}`}
        onClick={() => setExpanded(e => !e)}
        title="Click para ver transacciones"
      >
        <div className="block-header-row">
          <span className="block-index">
            {isGenesis ? 'GENESIS' : `Bloque #${block.index}`}
          </span>
          <span className="block-hash" title={block.hash || block.block_hash}>
            {shortHash(block.hash || block.block_hash)}
          </span>
        </div>

        <div className="block-meta">
          <span>{formatTimestamp(block.timestamp)}</span>
          <span>
            prev: <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
              {shortHash(block.previous_hash || block.prev_hash)}
            </span>
          </span>
        </div>

        <div className="block-meta" style={{ marginTop: '0.25rem' }}>
          <span className="block-txn-count">
            {txns.length} transacci{txns.length === 1 ? 'ón' : 'ones'}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {expanded ? '▲ ocultar' : '▼ ver detalle'}
          </span>
        </div>

        {expanded && txns.length > 0 && (
          <div className="block-transactions">
            {txns.map((txn, i) => (
              <div className="block-txn-item" key={i}>
                {typeof txn === 'string'
                  ? txn
                  : JSON.stringify(txn, null, 0).slice(0, 200)}
              </div>
            ))}
          </div>
        )}

        {expanded && txns.length === 0 && (
          <div className="block-transactions">
            <div className="block-txn-item" style={{ color: 'var(--text-muted)' }}>
              Sin transacciones
            </div>
          </div>
        )}
      </div>

      {!isLast && <div className="blockchain-connector" />}
    </div>
  )
}

export default function BlockchainViewer({ blocks = [] }) {
  if (!blocks || blocks.length === 0) {
    return (
      <div className="blockchain-viewer">
        <h2>Blockchain del evento</h2>
        <div className="empty-state" style={{ padding: '2rem 0' }}>
          <p>No hay bloques registrados aún.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="blockchain-viewer">
      <h2>Blockchain del evento</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {blocks.length} bloque{blocks.length !== 1 ? 's' : ''}. Hacé click para ver transacciones.
      </p>
      <div className="blockchain-chain">
        {blocks.map((block, i) => (
          <BlockEntry
            key={block.index ?? i}
            block={block}
            isLast={i === blocks.length - 1}
          />
        ))}
      </div>
    </div>
  )
}
