import { useState, useCallback, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls, TransformControls } from '@react-three/drei'
import type { Vec3 } from '../office3d-layout.ts'
import {
  RBox,
  OfficeChair, WorkDesk, MeetingTable, Sofa, CoffeeTable,
  Plant, Bookshelf, Television, WallClock,
  GalonDispenser, Fridge, PantryCounter, FlagPole,
  PlasticStool, Gerobak, KopiSepeda, Tree, StreetLamp,
  OfficeLight, AirConditioner, AcOutdoorUnit,
  PingPongTable, ArcadeCabinet, Beanbag, CarromTable,
} from '../scene3d/props.tsx'
import { woodFloor, tileFloor, carpet, grass, asphalt, pavingStones } from '../scene3d/textures.ts'

export interface BuilderAsset {
  id: string
  name: string
  description: string
  category: 'structure' | 'furniture' | 'decor' | 'tech' | 'indonesian' | 'outdoor' | 'lighting' | 'game'
  component: string
  defaultProps: Record<string, any>
  size: Vec3
}

export const ASSET_CATALOG: BuilderAsset[] = [
  // STRUCTURE
  {
    id: 'floor-wood',
    name: 'Lantai Kayu (Parquet)',
    description: 'Lantai kayu hangat untuk area kerja. Tekstur procedural, tidak perlu file gambar.',
    category: 'structure',
    component: 'WoodFloor',
    defaultProps: { repeat: [10, 10] as [number, number] },
    size: [10, 0.05, 10]
  },
  {
    id: 'floor-tile',
    name: 'Lantai Keramik',
    description: 'Keramik putih bersih untuk pantry/dapur. Mudah dibersihkan.',
    category: 'structure',
    component: 'TileFloor',
    defaultProps: { repeat: [8, 8] as [number, number] },
    size: [8, 0.03, 8]
  },
  {
    id: 'floor-carpet',
    name: 'Karpet',
    description: 'Karpet tebal untuk area lounge/meeting. Warna bisa diubah.',
    category: 'structure',
    component: 'Carpet',
    defaultProps: { color: '#5b6f8c', repeat: [4, 4] as [number, number] },
    size: [4, 0.02, 4]
  },
  {
    id: 'wall-glass',
    name: 'Dinding Kaca (Partition)',
    description: 'Pemisah ruang transparan. Bisa dipakai untuk meeting room atau lounge.',
    category: 'structure',
    component: 'GlassWall',
    defaultProps: { width: 5, height: 3, thickness: 0.05 },
    size: [5, 3, 0.05]
  },
  {
    id: 'wall-solid',
    name: 'Dinding Solid',
    description: 'Dinding bata/tembok standar. Untuk pembatas ruangan privat.',
    category: 'structure',
    component: 'SolidWall',
    defaultProps: { width: 5, height: 3, thickness: 0.2, color: '#dfe3e4' },
    size: [5, 3, 0.2]
  },

  // FURNITURE
  {
    id: 'desk-work',
    name: 'Meja Kerja + Monitor',
    description: 'Meja kerja standar dengan monitor, keyboard, mouse, dan mug kopi. Termasuk kursi.',
    category: 'furniture',
    component: 'WorkDesk',
    defaultProps: { active: true, withChair: true },
    size: [1.9, 1.5, 1.8]
  },
  {
    id: 'desk-meeting',
    name: 'Meja Rapat',
    description: 'Meja rapat oval besar dengan piring gorengan. Cocok 6-8 orang.',
    category: 'furniture',
    component: 'MeetingTable',
    defaultProps: {},
    size: [2.1, 0.75, 1.05]
  },
  {
    id: 'chair-office',
    name: 'Kursi Kantor Ergonomis',
    description: 'Kursi putar dengan roda 5 kaki, sandaran tinggi, dan mekanik gas lift.',
    category: 'furniture',
    component: 'OfficeChair',
    defaultProps: { color: '#2f3a44' },
    size: [0.6, 1.1, 0.6]
  },
  {
    id: 'sofa-lounge',
    name: 'Sofa Lounge 3 Dudukan',
    description: 'Sofa panjang untuk area santai. Bisa dipakai untuk ngobrol santai atau istirahat.',
    category: 'furniture',
    component: 'Sofa',
    defaultProps: { color: '#5b6f8c' },
    size: [2.4, 0.8, 1.0]
  },
  {
    id: 'coffee-table',
    name: 'Meja Kopi',
    description: 'Meja kopi kayu dengan teh botol dan toples kerupuk. Lengkapi area sofa.',
    category: 'furniture',
    component: 'CoffeeTable',
    defaultProps: {},
    size: [1.3, 0.45, 0.7]
  },
  {
    id: 'bookshelf',
    name: 'Rak Buku',
    description: 'Rak buku 3 tingkatan dengan buku berwarna-warni. Untuk referensi/dokumentasi.',
    category: 'furniture',
    component: 'Bookshelf',
    defaultProps: { rotation: 0 },
    size: [1.4, 2.0, 0.4]
  },

  // DECOR
  {
    id: 'plant-indoor',
    name: 'Tanaman Hias Indoor',
    description: 'Tanaman pot medium (monstera/sansevieria). Bisa resize dengan prop size.',
    category: 'decor',
    component: 'Plant',
    defaultProps: { size: 1 },
    size: [0.6, 1.2, 0.6]
  },
  {
    id: 'tv-wall',
    name: 'TV Dinding',
    description: 'TV layar datar 55" di dinding. Bisa menampilkan status/layar agent.',
    category: 'decor',
    component: 'Television',
    defaultProps: {},
    size: [2.0, 1.15, 0.08]
  },
  {
    id: 'clock-wall',
    name: 'Jam Dinding',
    description: 'Jam analog minimalis. Berfungsi juga sebagai dekorasi dinding.',
    category: 'decor',
    component: 'WallClock',
    defaultProps: {},
    size: [0.6, 0.6, 0.06]
  },

  // TECH
  {
    id: 'ac-split',
    name: 'AC Split (Indoor)',
    description: 'AC dinding dengan louvers yang bergoyang pelan. Pendingin ruangan.',
    category: 'tech',
    component: 'AirConditioner',
    defaultProps: { rotation: 0 },
    size: [1.05, 0.32, 0.24]
  },
  {
    id: 'ac-outdoor',
    name: 'AC Outdoor Unit',
    description: 'Unit luar AC dengan kipas berputar. Taruh di luar gedung/balkon.',
    category: 'tech',
    component: 'AcOutdoorUnit',
    defaultProps: { rotation: 0 },
    size: [0.85, 0.6, 0.32]
  },
  {
    id: 'light-office',
    name: 'Lampu Kantor LED Linear',
    description: 'Lampu gantung panjang putih dingin. Otomatis lebih terang malam hari.',
    category: 'lighting',
    component: 'OfficeLight',
    defaultProps: { night: false, rotation: 0 },
    size: [1.4, 0.06, 0.16]
  },

  // INDONESIAN TOUCHES
  {
    id: 'galon-dispenser',
    name: 'Dispenser Galon',
    description: 'Dispenser air dengan galon biru terbalik. Ikon kantor Indonesia klasik.',
    category: 'indonesian',
    component: 'GalonDispenser',
    defaultProps: { rotation: 0 },
    size: [0.42, 1.6, 0.42]
  },
  {
    id: 'fridge',
    name: 'Kulkas 2 Pintu',
    description: 'Kulkas besar untuk pantry. Simpan makanan/minum tim.',
    category: 'indonesian',
    component: 'Fridge',
    defaultProps: { rotation: 0 },
    size: [0.75, 1.8, 0.7]
  },
  {
    id: 'pantry-counter',
    name: 'Dapur Pantry Lengkap',
    description: 'Counter dengan rice cooker, kettle, kopi sachet. Wajib untuk tim Indonesia.',
    category: 'indonesian',
    component: 'PantryCounter',
    defaultProps: { rotation: 0 },
    size: [2.0, 1.0, 0.6]
  },
  {
    id: 'flag-pole',
    name: 'Tiang Bendera Merah Putih',
    description: 'Bendera Indonesia berkibar alami (animasi kain). Simbol nasionalisme.',
    category: 'indonesian',
    component: 'FlagPole',
    defaultProps: {},
    size: [0.35, 7.2, 0.35]
  },
  {
    id: 'gerobak-bakso',
    name: 'Gerobak Bakso',
    description: 'Gerobak bakso lengkap: dandang uap, kaca display, bakso, stool plastik, lampu malam.',
    category: 'indonesian',
    component: 'Gerobak',
    defaultProps: { night: false, rotation: 0 },
    size: [2.1, 2.4, 1.1]
  },
  {
    id: 'kopi-sepeda',
    name: 'Kopi Keliling (Sepeda)',
    description: 'Sepeda dengan kotak dingin, termos, sachet kopi gantung, papan "KOPI PANAS/ES".',
    category: 'indonesian',
    component: 'KopiSepeda',
    defaultProps: { night: false, rotation: 0 },
    size: [1.5, 1.4, 0.6]
  },

  // OUTDOOR
  {
    id: 'tree-large',
    name: 'Pohon Besar',
    description: 'Pohon rindang dengan batang kayu dan daun ikosahedron. Size bisa diubah.',
    category: 'outdoor',
    component: 'Tree',
    defaultProps: { size: 1 },
    size: [2.0, 3.5, 2.0]
  },
  {
    id: 'street-lamp',
    name: 'Lampu Jalan',
    description: 'Lampu jalan tinggi dengan cahaya hangat. Nyala otomatis malam hari.',
    category: 'outdoor',
    component: 'StreetLamp',
    defaultProps: { night: false },
    size: [0.8, 3.2, 0.8]
  },
  {
    id: 'stool-plastic',
    name: 'Stool Plastik Warna',
    description: 'Stool plastik merah/biru/kuning. Untuk gerobak, warung, atau seating santai.',
    category: 'outdoor',
    component: 'PlasticStool',
    defaultProps: { color: '#d64545' },
    size: [0.38, 0.42, 0.38]
  },

  // GAME ROOM
  {
    id: 'pingpong-table',
    name: 'Meja Ping Pong',
    description: 'Meja tenis meja standar internasional dengan net, bola, dan raket.',
    category: 'game',
    component: 'PingPongTable',
    defaultProps: {},
    size: [2.74, 0.85, 1.52]
  },
  {
    id: 'arcade-cabinet',
    name: 'Arcade Cabinet',
    description: 'Mesin arcade retro dengan layar LED berkedip. 2 unit berdampingan.',
    category: 'game',
    component: 'ArcadeCabinet',
    defaultProps: { color: '#1c1f24' },
    size: [0.72, 1.8, 0.62]
  },
  {
    id: 'beanbag',
    name: 'Beanbag Gaming',
    description: 'Beanbag bulat nyaman untuk main game/console. Warna bebas.',
    category: 'game',
    component: 'Beanbag',
    defaultProps: { color: '#6a4d8d' },
    size: [0.84, 0.45, 0.84]
  },
  {
    id: 'carrom-table',
    name: 'Meja Carrom (Karambol)',
    description: 'Pap karambol kayu dengan bidak putih/hitam/merah + 2 stool plastik.',
    category: 'game',
    component: 'CarromTable',
    defaultProps: {},
    size: [0.9, 0.68, 0.9]
  },
]

export const CATEGORIES = [
  { id: 'structure', name: 'Struktur Bangunan', icon: '🏗️', color: '#6b4a32' },
  { id: 'furniture', name: 'Furniture Kantor', icon: '🪑', color: '#d9c3a0' },
  { id: 'decor', name: 'Dekorasi Interior', icon: '🪴', color: '#4f8a4a' },
  { id: 'tech', name: 'Teknologi & AC', icon: '❄️', color: '#3d7fd6' },
  { id: 'lighting', name: 'Pencahayaan', icon: '💡', color: '#f4d35e' },
  { id: 'indonesian', name: 'Khas Indonesia', icon: '🇮🇩', color: '#ce1126' },
  { id: 'outdoor', name: 'Outdoor & Landscape', icon: '🌳', color: '#3f7a3c' },
  { id: 'game', name: 'Ruang Game', icon: '🎮', color: '#e63946' },
] as const

export interface PlacedAsset {
  id: string
  assetId: string
  position: Vec3
  rotation: number
  scale: number
  props: Record<string, any>
  size: Vec3
}

export interface BuilderState {
  placedAssets: PlacedAsset[]
  selectedAssetId: string | null
  hoveredAssetId: string | null
  gridSnap: number
  showGrid: boolean
}

const initialState: BuilderState = {
  placedAssets: [],
  selectedAssetId: null,
  hoveredAssetId: null,
  gridSnap: 0.5,
  showGrid: true,
}

export function useBuilderStore() {
  const [state, setState] = useState<BuilderState>(initialState)

  const addAsset = useCallback((assetId: string, position: Vec3 = [0, 0, 0]) => {
    const asset = ASSET_CATALOG.find(a => a.id === assetId)
    if (!asset) return
    const newAsset: PlacedAsset = {
      id: `${assetId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      assetId,
      position: [...position] as Vec3,
      rotation: 0,
      scale: 1,
      props: { ...asset.defaultProps },
      size: asset.size,
    }
    setState(prev => ({ ...prev, placedAssets: [...prev.placedAssets, newAsset] }))
  }, [])

  const removeAsset = useCallback((id: string) => {
    setState(prev => ({ ...prev, placedAssets: prev.placedAssets.filter(a => a.id !== id) }))
  }, [])

  const updateAsset = useCallback((id: string, updates: Partial<PlacedAsset>) => {
    setState(prev => ({
      ...prev,
      placedAssets: prev.placedAssets.map(a => a.id === id ? { ...a, ...updates } : a)
    }))
  }, [])

  const selectAsset = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, selectedAssetId: id }))
  }, [])

  const hoverAsset = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, hoveredAssetId: id }))
  }, [])

  const toggleGrid = useCallback(() => {
    setState(prev => ({ ...prev, showGrid: !prev.showGrid }))
  }, [])

  const setGridSnap = useCallback((snap: number) => {
    setState(prev => ({ ...prev, gridSnap: snap }))
  }, [])

  const exportLayout = useCallback(() => {
    return JSON.stringify(state.placedAssets, null, 2)
  }, [state.placedAssets])

  const importLayout = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) {
        setState(prev => ({ ...prev, placedAssets: parsed }))
      }
    } catch (e) {
      console.error('Invalid layout JSON:', e)
    }
  }, [])

  const clearAll = useCallback(() => {
    setState(prev => ({ ...prev, placedAssets: [] }))
  }, [])

  return {
    ...state,
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
  }
}

export function BuilderGrid({ size = 50, divisions = 50, color = '#3a3f44' }: { size?: number; divisions?: number; color?: string }) {
  return (
    <gridHelper args={[size, divisions, color, color]} />
  )
}

export function AssetPreview({ asset }: { asset: BuilderAsset }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame((state: { clock: THREE.Clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.3
    }
  })
  return (
    <group ref={groupRef} scale={0.5}>
      <AssetRenderer assetId={asset.id} />
    </group>
  )
}

export function AssetRenderer({ assetId, position = [0, 0, 0], rotation = 0, scale = 1, props = {}, selected = false, hovered = false }: {
  assetId: string
  position?: Vec3
  rotation?: number
  scale?: number
  props?: Record<string, any>
  selected?: boolean
  hovered?: boolean
}) {
  const asset = useMemo(() => ASSET_CATALOG.find(a => a.id === assetId), [assetId])
  if (!asset) return null

  const outlineColor = selected ? '#f4d35e' : hovered ? '#3a86ff' : null

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={[scale, scale, scale]}>
      {outlineColor && (
        <mesh position={[0, (asset.size[1] / 2) * scale, 0]}>
          <boxGeometry args={[asset.size[0] * scale * 1.05, asset.size[1] * scale * 1.05, asset.size[2] * scale * 1.05] as [number, number, number]} />
          <meshBasicMaterial color={outlineColor} transparent opacity={0.15} wireframe />
        </mesh>
      )}
      <RenderAssetComponent component={asset.component} props={props} />
    </group>
  )
}

function RenderAssetComponent({ component, props }: { component: string; props: Record<string, any> }) {
  switch (component) {
    case 'WoodFloor': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*5.12||51.2, props.repeat?.[1]*5.12||51.2]}/><meshStandardMaterial map={woodFloor(props.repeat || [10,10])} /></mesh>
    case 'TileFloor': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*2.56||20.48, props.repeat?.[1]*2.56||20.48]}/><meshStandardMaterial map={tileFloor(props.repeat || [8,8])} /></mesh>
    case 'Carpet': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*1.28||5.12, props.repeat?.[1]*1.28||5.12]}/><meshStandardMaterial map={carpet(props.color || '#5b6f8c', props.repeat || [4,4])} /></mesh>
    case 'Grass': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*2.56||20.48, props.repeat?.[1]*2.56||20.48]}/><meshStandardMaterial map={grass(props.repeat || [8,8])} /></mesh>
    case 'Asphalt': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*2.56||20.48, props.repeat?.[1]*2.56||20.48]}/><meshStandardMaterial map={asphalt(props.repeat || [8,8])} /></mesh>
    case 'PavingStones': return <mesh rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[props.repeat?.[0]*2.56||20.48, props.repeat?.[1]*2.56||20.48]}/><meshStandardMaterial map={pavingStones(props.repeat || [8,8])} /></mesh>

    case 'GlassWall':
      return <RBox position={[0, props.height/2||1.5, 0]} size={[props.width||5, props.height||3, props.thickness||0.05]} radius={0.01} color="#8fd0ff" opacity={0.3} roughness={0.05} metalness={0.1} />
    case 'SolidWall':
      return <RBox position={[0, props.height/2||1.5, 0]} size={[props.width||5, props.height||3, props.thickness||0.2]} radius={0.02} color={props.color || '#dfe3e4'} roughness={0.7} />

    case 'WorkDesk': return <WorkDesk position={[0, 0, 0]} active={props.active ?? true} withChair={props.withChair ?? true} />
    case 'MeetingTable': return <MeetingTable position={[0, 0, 0]} />
    case 'OfficeChair': return <OfficeChair position={[0, 0, 0]} color={props.color || '#2f3a44'} />
    case 'Sofa': return <Sofa position={[0, 0, 0]} color={props.color || '#5b6f8c'} />
    case 'CoffeeTable': return <CoffeeTable position={[0, 0, 0]} />
    case 'Bookshelf': return <Bookshelf position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'Plant': return <Plant position={[0, 0, 0]} size={props.size || 1} />
    case 'Television': return <Television position={[0, 0, 0]} />
    case 'WallClock': return <WallClock position={[0, 0, 0]} />
    case 'AirConditioner': return <AirConditioner position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'AcOutdoorUnit': return <AcOutdoorUnit position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'OfficeLight': return <OfficeLight position={[0, 0, 0]} night={props.night ?? false} rotation={props.rotation || 0} />
    case 'GalonDispenser': return <GalonDispenser position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'Fridge': return <Fridge position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'PantryCounter': return <PantryCounter position={[0, 0, 0]} rotation={props.rotation || 0} />
    case 'FlagPole': return <FlagPole position={[0, 0, 0]} />
    case 'PlasticStool': return <PlasticStool position={[0, 0, 0]} color={props.color || '#d64545'} />
    case 'Gerobak': return <Gerobak position={[0, 0, 0]} night={props.night ?? false} rotation={props.rotation || 0} />
    case 'KopiSepeda': return <KopiSepeda position={[0, 0, 0]} night={props.night ?? false} rotation={props.rotation || 0} />
    case 'Tree': return <Tree position={[0, 0, 0]} size={props.size || 1} />
    case 'StreetLamp': return <StreetLamp position={[0, 0, 0]} night={props.night ?? false} />
    case 'PingPongTable': return <PingPongTable position={[0, 0, 0]} />
    case 'ArcadeCabinet': return <ArcadeCabinet position={[0, 0, 0]} color={props.color || '#1c1f24'} />
    case 'Beanbag': return <Beanbag position={[0, 0, 0]} color={props.color || '#6a4d8d'} />
    case 'CarromTable': return <CarromTable position={[0, 0, 0]} />

    default:
      return <RBox position={[0, 0.5, 0]} size={[1, 1, 1]} radius={0.05} color="#ff00ff" />
  }
}

export function BuilderCanvas({ placedAssets, selectedId, hoveredId, onSelect, onHover, onDragEnd }: {
  placedAssets: PlacedAsset[]
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onDragEnd: (id: string, position: Vec3) => void
}) {
  return (
    <Canvas camera={{ position: [-3.9, 15.2, 18.8], fov: 50 }} style={{ width: '100%', height: '100%' }}>
      <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} minPolarAngle={0.1} maxPolarAngle={Math.PI / 2.1} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />
      <directionalLight position={[-10, 15, -10]} intensity={0.5} />

      <BuilderGrid />

      {placedAssets.map(asset => (
        <DraggableAsset
          key={asset.id}
          asset={asset}
          isSelected={asset.id === selectedId}
          isHovered={asset.id === hoveredId}
          onSelect={onSelect}
          onHover={onHover}
          onDragEnd={onDragEnd}
        />
      ))}
    </Canvas>
  )
}

function DraggableAsset({ asset, isSelected, isHovered, onSelect, onHover, onDragEnd }: {
  asset: PlacedAsset
  isSelected: boolean
  isHovered: boolean
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onDragEnd: (id: string, position: Vec3) => void
}) {
  const [dragPos, setDragPos] = useState<Vec3>(asset.position)
  const isDragging = useRef(false)

  const handlePointerDown = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    isDragging.current = true
    onSelect(asset.id)
  }

  const handlePointerUp = () => {
    if (isDragging.current) {
      isDragging.current = false
      onDragEnd(asset.id, dragPos)
    }
  }

  const handlePointerMove = (event: { point?: THREE.Vector3 }) => {
    if (isDragging.current && event.point) {
      setDragPos([event.point.x, asset.position[1], event.point.z])
    }
  }

  return (
    <group position={isDragging.current ? dragPos : asset.position} rotation={[0, asset.rotation, 0]} scale={asset.scale}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerOver={() => onHover(asset.id)}
      onPointerOut={() => onHover(null)}
    >
      <AssetRenderer
        assetId={asset.assetId}
        position={[0, 0, 0]}
        rotation={0}
        scale={asset.scale}
        props={asset.props}
        selected={isSelected}
        hovered={isHovered}
      />
      {isSelected && (
        <GizmoHelper asset={asset} onChange={onDragEnd} />
      )}
    </group>
  )
}

function GizmoHelper({ asset, onChange }: { asset: PlacedAsset; onChange: (id: string, position: Vec3) => void }) {
  const transformRef = useRef<any>(null)
  return (
    <group>
      <TransformControls
        ref={transformRef}
        mode="translate"
        onMouseUp={() => {
          if (transformRef.current?.object) {
            const p = transformRef.current.object.position
            onChange(asset.id, [p.x, p.y, p.z])
          }
        }}
        size={0.8}
      >
        <mesh position={[0, asset.size?.[1] || 1, 0]}>
          <octahedronGeometry args={[0.15]} />
          <meshBasicMaterial color="#f4d35e" />
        </mesh>
      </TransformControls>
    </group>
  )
}

export type { Vec3 }