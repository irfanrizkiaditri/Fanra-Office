import { useState, useCallback } from 'react'
import { BuilderCanvas, useBuilderStore, ASSET_CATALOG, CATEGORIES, type PlacedAsset } from '../builder/BuilderSystem'
import type { BuilderAsset } from '../builder/BuilderSystem'

function AssetPalette({ catalog, onAddAsset, selectedCategory }: {
  catalog: BuilderAsset[]
  onAddAsset: (id: string) => void
  selectedCategory: string
}) {
  const filtered = catalog.filter(a => a.category === selectedCategory)
  return (
    <div className="builder-palette">
      <div className="palette-header">
        <h3>Aset: {CATEGORIES.find(c => c.id === selectedCategory)?.name}</h3>
        <p className="palette-count">{filtered.length} item</p>
      </div>
      <div className="palette-grid">
        {filtered.map(asset => (
          <button
            key={asset.id}
            className="asset-card"
            onClick={() => onAddAsset(asset.id)}
            title={asset.description}
          >
            <div className="asset-preview">
              <AssetPreviewMini assetId={asset.id} />
            </div>
            <div className="asset-info">
              <span className="asset-name">{asset.name}</span>
              <span className="asset-category">{CATEGORIES.find(c => c.id === asset.category)?.icon}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function AssetPreviewMini({ }: { assetId?: string }) {
  return (
    <div style={{ width: '64px', height: '64px', background: '#1c2024', borderRadius: '8px' }} />
  )
}

function CategoryTabs({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <div className="category-tabs" role="tablist">
      {CATEGORIES.map(cat => (
        <button
          key={cat.id}
          role="tab"
          aria-selected={active === cat.id}
          className={`cat-tab ${active === cat.id ? 'active' : ''}`}
          onClick={() => onChange(cat.id)}
          style={{ borderLeftColor: cat.color }}
        >
          <span className="cat-icon">{cat.icon}</span>
          <span className="cat-label">{cat.name}</span>
        </button>
      ))}
    </div>
  )
}

function PropertiesPanel({ asset, onUpdate, onRemove, catalog }: {
  asset: PlacedAsset | null
  onUpdate: (id: string, updates: Partial<PlacedAsset>) => void
  onRemove: (id: string) => void
  catalog: BuilderAsset[]
}) {
  if (!asset) {
    return (
      <div className="properties-empty">
        <p>Klik aset di kanvas untuk edit properti</p>
        <p className="hint">Atau pilih dari palette di kiri</p>
      </div>
    )
  }

  const assetDef = catalog.find(a => a.id === asset.assetId)
  const [expanded, setExpanded] = useState(true)

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(e.currentTarget.open)
  }

  return (
    <div className="properties-panel">
      <div className="prop-header">
        <h3>{assetDef?.name || asset.assetId}</h3>
        <button className="icon-btn" onClick={() => onRemove(asset.id)} title="Hapus">🗑</button>
      </div>

      <details open={expanded} onToggle={handleToggle}>
        <summary>Transform</summary>
        <div className="prop-group">
          <label>Posisi X</label>
          <input type="number" step="0.1" value={asset.position[0]} onChange={e => onUpdate(asset.id, { position: [parseFloat(e.target.value), asset.position[1], asset.position[2]] })} />
        </div>
        <div className="prop-group">
          <label>Posisi Y</label>
          <input type="number" step="0.1" value={asset.position[1]} onChange={e => onUpdate(asset.id, { position: [asset.position[0], parseFloat(e.target.value), asset.position[2]] })} />
        </div>
        <div className="prop-group">
          <label>Posisi Z</label>
          <input type="number" step="0.1" value={asset.position[2]} onChange={e => onUpdate(asset.id, { position: [asset.position[0], asset.position[1], parseFloat(e.target.value)] })} />
        </div>
        <div className="prop-group">
          <label>Rotasi (derajat)</label>
          <input type="number" step="15" value={Math.round(asset.rotation * 180 / Math.PI)} onChange={e => onUpdate(asset.id, { rotation: parseFloat(e.target.value) * Math.PI / 180 })} />
        </div>
        <div className="prop-group">
          <label>Skala</label>
          <input type="number" step="0.1" min="0.1" max="5" value={asset.scale} onChange={e => onUpdate(asset.id, { scale: parseFloat(e.target.value) })} />
        </div>
      </details>

      {assetDef && Object.keys(assetDef.defaultProps).length > 0 && (
        <details open={expanded} onToggle={handleToggle}>
          <summary>Properti Kustom</summary>
          {Object.entries(assetDef.defaultProps).map(([key, defaultVal]) => (
            <div key={key} className="prop-group">
              <label>{key}</label>
              {typeof defaultVal === 'boolean' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={asset.props[key] ?? defaultVal}
                    onChange={e => onUpdate(asset.id, { props: { ...asset.props, [key]: e.target.checked } })}
                  />
                  {String(key)}
                </label>
              )}
              {typeof defaultVal === 'number' && (
                <input type="number" step="0.1" value={asset.props[key] ?? defaultVal} onChange={e => onUpdate(asset.id, { props: { ...asset.props, [key]: parseFloat(e.target.value) } })} />
              )}
              {typeof defaultVal === 'string' && (
                <input type="text" value={asset.props[key] ?? defaultVal} onChange={e => onUpdate(asset.id, { props: { ...asset.props, [key]: e.target.value } })} />
              )}
              {Array.isArray(defaultVal) && (
                <input type="text" value={JSON.stringify(asset.props[key] ?? defaultVal)} onChange={e => { try { onUpdate(asset.id, { props: { ...asset.props, [key]: JSON.parse(e.target.value) } }) } catch {} }} placeholder={JSON.stringify(defaultVal)} />
              )}
            </div>
          ))}
        </details>
      )}

      <details open={expanded} onToggle={handleToggle}>
        <summary>Deskripsi</summary>
        <p className="asset-desc">{assetDef?.description || 'Tidak ada deskripsi'}</p>
        <p className="asset-category-full">Kategori: {CATEGORIES.find(c => c.id === assetDef?.category)?.name}</p>
        <p className="asset-size">Ukuran default: {assetDef?.size.join(' × ')} m</p>
      </details>
    </div>
  )
}

function Toolbar({ onExport, onClear, onToggleGrid, gridSnap, onSetGridSnap, showGrid, onImport }: {
  onExport: () => void
  onClear: () => void
  onToggleGrid: () => void
  gridSnap: number
  onSetGridSnap: (snap: number) => void
  showGrid: boolean
  onImport: (file: File) => void
}) {
  return (
    <div className="builder-toolbar">
      <div className="toolbar-group">
        <button className="btn btn-primary" onClick={onExport}>📤 Export JSON</button>
        <label className="btn btn-secondary">
          📥 Import
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) { onImport(f); e.target.value = '' } }} />
        </label>
        <button className="btn btn-danger" onClick={onClear}>🗑 Clear All</button>
      </div>
      <div className="toolbar-group">
        <label className="toggle">
          <input type="checkbox" checked={showGrid} onChange={onToggleGrid} />
          <span>Grid</span>
        </label>
        <label>
          Snap: <select value={gridSnap} onChange={e => onSetGridSnap(parseFloat(e.target.value))}>
            <option value={0.25}>0.25m</option>
            <option value={0.5}>0.5m</option>
            <option value={1}>1m</option>
            <option value={2}>2m</option>
          </select>
        </label>
      </div>
    </div>
  )
}

export function Builder() {
  const {
    placedAssets,
    selectedAssetId,
    hoveredAssetId,
    gridSnap,
    showGrid,
    addAsset,
    removeAsset,
    updateAsset,
    selectAsset,
    hoverAsset,
    toggleGrid,
    setGridSnap,
    exportLayout,
    importLayout,
    clearAll,
  } = useBuilderStore()

  const [selectedCategory, setSelectedCategory] = useState('furniture')

  const selectedAsset = placedAssets.find(a => a.id === selectedAssetId) || null

  const handleExport = useCallback(() => {
    const json = exportLayout()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ruang-layout-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportLayout])

  const handleImport = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      if (text) importLayout(text)
    }
    reader.readAsText(file)
  }, [importLayout])

  return (
    <div className="builder-page">
      <Toolbar
        onExport={handleExport}
        onImport={handleImport}
        onClear={clearAll}
        onToggleGrid={toggleGrid}
        gridSnap={gridSnap}
        onSetGridSnap={setGridSnap}
        showGrid={showGrid}
      />

      <div className="builder-main">
        <aside className="builder-sidebar">
          <CategoryTabs active={selectedCategory} onChange={setSelectedCategory} />
          <AssetPalette
            catalog={ASSET_CATALOG}
            onAddAsset={id => addAsset(id, [0, 0, 0])}
            selectedCategory={selectedCategory}
          />
        </aside>

        <main className="builder-canvas-area">
          <BuilderCanvas
            placedAssets={placedAssets}
            selectedId={selectedAssetId}
            hoveredId={hoveredAssetId}
            onSelect={selectAsset}
            onHover={hoverAsset}
            onDragEnd={(id, position) => updateAsset(id, { position })}
          />
        </main>

        <aside className="builder-properties">
          <PropertiesPanel
            asset={selectedAsset}
            onUpdate={updateAsset}
            onRemove={removeAsset}
            catalog={ASSET_CATALOG}
          />
        </aside>
      </div>

      <style>{`
        .builder-page {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: #0d1112;
          color: #e8e1d0;
          font-family: 'IBM Plex Sans', system-ui, sans-serif;
        }
        .builder-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #151a1d;
          border-bottom: 1px solid #2a2f33;
          flex-wrap: wrap;
          gap: 12px;
        }
        .toolbar-group {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .btn {
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-weight: 500;
          font-size: 13px;
          transition: all 0.15s;
        }
        .btn-primary { background: #2a9d8f; color: white; }
        .btn-primary:hover { background: #2ec4b6; }
        .btn-secondary { background: #2a2f33; color: #e8e1d0; border: 1px solid #3a3f44; }
        .btn-secondary:hover { background: #3a3f44; }
        .btn-danger { background: #c62828; color: white; }
        .btn-danger:hover { background: #e63946; }
        .toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .toggle input { accent-color: #2a9d8f; }
        select {
          background: #1c2024;
          border: 1px solid #3a3f44;
          color: #e8e1d0;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 13px;
        }
        .builder-main {
          display: flex;
          flex: 1;
          overflow: hidden;
          position: relative;
        }
        .builder-sidebar {
          width: 280px;
          background: #151a1d;
          border-right: 1px solid #2a2f33;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .category-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 12px;
          border-bottom: 1px solid #2a2f33;
        }
        .cat-tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 12px;
          background: #1c2024;
          border: 1px solid #2a2f33;
          border-left-width: 3px;
          border-radius: 6px;
          color: #a9b1b8;
          cursor: pointer;
          font-size: 11px;
          transition: all 0.15s;
          min-width: 70px;
        }
        .cat-tab:hover { background: #2a2f33; color: #e8e1d0; }
        .cat-tab.active {
          background: #1c2024;
          color: #e8e1d0;
          border-color: #2a9d8f;
        }
        .cat-icon { font-size: 16px; }
        .cat-label { white-space: nowrap; }
        .builder-palette { flex: 1; padding: 12px; }
        .palette-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .palette-header h3 { font-size: 14px; font-weight: 600; margin: 0; }
        .palette-count { font-size: 12px; color: #7a838a; }
        .palette-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        .asset-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 10px;
          background: #1c2024;
          border: 1px solid #2a2f33;
          border-radius: 8px;
          color: #e8e1d0;
          cursor: pointer;
          transition: all 0.15s;
          text-align: center;
        }
        .asset-card:hover {
          border-color: #2a9d8f;
          background: #1e282c;
          transform: translateY(-2px);
        }
        .asset-preview { width: 64px; height: 64px; }
        .asset-name { font-size: 11px; font-weight: 500; line-height: 1.2; }
        .asset-category { font-size: 14px; }
        .builder-canvas-area {
          flex: 1;
          position: relative;
          min-width: 0;
        }
        .builder-canvas-area > div { width: 100%; height: 100%; }
        .builder-properties {
          width: 300px;
          background: #151a1d;
          border-left: 1px solid #2a2f33;
          padding: 16px;
          overflow-y: auto;
        }
        .properties-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #7a838a;
          text-align: center;
          padding: 20px;
        }
        .properties-empty .hint { font-size: 12px; margin-top: 8px; }
        .prop-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid #2a2f33;
        }
        .prop-header h3 { font-size: 14px; margin: 0; }
        .icon-btn {
          background: none;
          border: 1px solid #3a3f44;
          color: #a9b1b8;
          padding: 6px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        .icon-btn:hover { background: #c62828; border-color: #c62828; color: white; }
        details { margin-bottom: 16px; }
        summary { cursor: pointer; font-weight: 600; font-size: 13px; color: #e8e1d0; padding: 8px 0; }
        .prop-group { margin-bottom: 12px; }
        .prop-group label { display: block; font-size: 12px; color: #a9b1b8; margin-bottom: 4px; }
        .prop-group input[type="number"],
        .prop-group input[type="text"] {
          width: 100%;
          padding: 8px 10px;
          background: #1c2024;
          border: 1px solid #3a3f44;
          border-radius: 4px;
          color: #e8e1d0;
          font-size: 13px;
        }
        .prop-group input:focus { outline: none; border-color: #2a9d8f; }
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 13px;
        }
        .asset-desc { font-size: 12px; color: #a9b1b8; line-height: 1.5; margin: 8px 0; }
        .asset-category-full { font-size: 11px; color: #7a838a; }
        .asset-size { font-size: 11px; color: #7a838a; margin-top: 4px; }
        @media (max-width: 1200px) {
          .builder-sidebar { width: 240px; }
          .builder-properties { width: 260px; }
        }
        @media (max-width: 900px) {
          .builder-main { flex-direction: column; }
          .builder-sidebar, .builder-properties { width: 100%; max-height: 300px; border: none; border-top: 1px solid #2a2f33; }
          .builder-canvas-area { height: 50vh; }
        }
      `}</style>
    </div>
  )
}