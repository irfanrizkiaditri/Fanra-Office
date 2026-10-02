import { useMemo } from 'react'
import { ARCADES, BEANBAGS, CARROM, COFFEE_TABLE, FLAG, GAME_DOOR, GAME_ROOM, GAME_TV, LOUNGE_PARTITION_END_Z, MEETING_TABLE, PARTITION_X, PING_PONG, SOFA, STALL_ROTATION, type OfficeLayout, TV, type Vec3 } from '../office3d-layout.ts'
import { AcOutdoorUnit, AirConditioner, ArcadeCabinet, Armchair, Beanbag, Bookshelf, CarromTable, CoffeeTable, FlagPole, Fridge, GalonDispenser, Gerobak, KopiSepeda, MeetingTable, OfficeLight, PantryCounter, PingPongTable, Plant, RBox, Sofa, StreetLamp, Television, Tree, Vendor, WallClock } from './props.tsx'
import { asphalt, carpet, grass, pavingStones, tileFloor, woodFloor } from './textures.ts'

// The building (floors, walls, windows, furniture) and its surroundings (yard, sidewalk,
// street food, the flag and the road). In the evening (dark theme) the lamps come on. Walls facing the camera are kept low, like a
// cut-away dollhouse, so the inside stays visible from any angle the controls allow.

const WALL = '#efe6d6'
const WALL_TOP = '#d9cdb8'
const WALL_HEIGHT = 2.6
const THICK = 0.25

function Floor({ position, size, map, color = '#ffffff', roughness = 0.8 }: { position: Vec3; size: [number, number]; map?: ReturnType<typeof woodFloor>; color?: string; roughness?: number }) {
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
    <planeGeometry args={size}/>
    <meshStandardMaterial map={map} color={color} roughness={roughness}/>
  </mesh>
}

function Wall({ from, to, height = WALL_HEIGHT }: { from: [number, number]; to: [number, number]; height?: number }) {
  const [x1, z1] = from
  const [x2, z2] = to
  const length = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(z2 - z1, x2 - x1)
  return <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, -angle, 0]}>
    <RBox position={[0, height / 2, 0]} size={[length + THICK, height, THICK]} radius={0.02} color={WALL} roughness={0.9}/>
    <RBox position={[0, height + 0.02, 0]} size={[length + THICK + 0.02, 0.05, THICK + 0.04]} radius={0.01} color={WALL_TOP}/>
  </group>
}

function Window({ position, width = 1.8, night }: { position: Vec3; width?: number; night: boolean }) {
  return <group position={position}>
    <RBox position={[0, 0, 0]} size={[width + 0.12, 1.22, 0.12]} radius={0.02} color="#5a4636"/>
    <mesh position={[0, 0, 0.065]}><planeGeometry args={[width, 1.1]}/><meshStandardMaterial color={night ? '#2d3f5c' : '#9fd3ea'} emissive={night ? '#1c2c4a' : '#6fb6d6'} emissiveIntensity={0.35} roughness={0.05} metalness={0.2}/></mesh>
    <RBox position={[0, 0, 0.08]} size={[0.05, 1.1, 0.03]} radius={0.01} color="#5a4636"/>
  </group>
}

/** A glass pane along x = const, from `bottom` up to near the top of the walls. */
function Glass({ x, fromZ, toZ, bottom }: { x: number; fromZ: number; toZ: number; bottom: number }) {
  const top = WALL_HEIGHT - 0.2
  return <RBox position={[x, (bottom + top) / 2, (fromZ + toZ) / 2]} size={[0.05, top - bottom, Math.abs(toZ - fromZ)]} radius={0.01} color="#cfe8ee" opacity={0.25} roughness={0.05} shadow={false}/>
}

/** The game room wing: ping-pong, arcade machines, a console corner and a karambol board. */
function GameRoom({ night }: { night: boolean }) {
  const { minX, maxX, minZ, maxZ } = GAME_ROOM
  const floor = useMemo(() => carpet('#3b4170', [3, 3]), [])
  return <group>
    <Floor position={[(minX + maxX) / 2, 0.006, (minZ + maxZ) / 2]} size={[maxX - minX, maxZ - minZ]} map={floor} roughness={0.9}/>
    <Wall from={[minX, minZ]} to={[maxX, minZ]}/>
    <Wall from={[maxX, minZ]} to={[maxX, maxZ]}/>
    <Wall from={[minX, maxZ]} to={[maxX, maxZ]} height={0.55}/>
    <group rotation={[0, -Math.PI / 2, 0]} position={[maxX - 0.14, 1.55, -2.2]}><Window position={[0, 0, 0]} width={1.6} night={night}/></group>
    <PingPongTable position={PING_PONG}/>
    {ARCADES.map((position, index) => <ArcadeCabinet key={index} position={position} color={index === 0 ? '#c62828' : '#1d4ed8'}/>)}
    <RBox position={[GAME_TV[0], 0.25, GAME_TV[2] + 0.2]} size={[1.8, 0.5, 0.4]} radius={0.03} color="#1f2328"/>
    <RBox position={[GAME_TV[0] - 0.3, 0.55, GAME_TV[2] + 0.2]} size={[0.36, 0.08, 0.26]} radius={0.02} color="#f2f2f2"/>
    <Television position={[GAME_TV[0], 1.35, GAME_TV[2] + 0.02]}/>
    {BEANBAGS.map((position, index) => <Beanbag key={index} position={position} color={index === 0 ? '#e76f51' : '#2a9d8f'}/>)}
    <CarromTable position={CARROM}/>
    <Plant position={[maxX - 0.5, 0, maxZ - 0.5]} size={0.9}/>
    <AirConditioner position={[(minX + maxX) / 2 - 0.6, 2.3, minZ + 0.125]}/>
    {[[PING_PONG[0], 2.4, PING_PONG[2]], [ARCADES[0][0] + 0.5, 2.4, -3.6], [GAME_TV[0], 2.4, -3.6]].map((position) => <OfficeLight key={position.join(',')} position={position as Vec3} night={night}/>)}
  </group>
}

function Building({ night, layout }: { night: boolean; layout: OfficeLayout }) {
  const { minX, maxX, minZ, maxZ } = layout.building
  const wood = useMemo(() => woodFloor([4, 4]), [])
  const tiles = useMemo(() => tileFloor([3, 5]), [])
  const rug = useMemo(() => carpet('#5b7c8c', [2, 2]), [])
  const meetingRug = useMemo(() => carpet('#8a4b3c', [2, 2]), [])
  return <group>
    {/* Floors: parquet everywhere, tiles in the pantry, rugs in the lounge and meeting area */}
    <Floor position={[(minX + maxX) / 2, 0.005, (minZ + maxZ) / 2]} size={[maxX - minX, maxZ - minZ]} map={wood} roughness={0.55}/>
    <Floor position={[8.35, 0.01, 1.4]} size={[2.3, 5.4]} map={tiles} roughness={0.35}/>
    <Floor position={[4.6, 0.012, -2.9]} size={[4.4, 2.8]} map={rug}/>
    <Floor position={[-5.2, 0.012, 2.2]} size={[3.6, 3]} map={meetingRug}/>
    {/* Full-height back and left walls, low walls towards the camera */}
    <Wall from={[minX, minZ]} to={[maxX, minZ]}/>
    <Wall from={[minX, minZ]} to={[minX, maxZ]}/>
    {/* Right wall: the lounge side opens into the game room through a door, glass above */}
    <Wall from={[maxX, minZ]} to={[maxX, GAME_DOOR.fromZ]} height={1.1}/>
    <Wall from={[maxX, GAME_DOOR.toZ]} to={[maxX, maxZ]} height={1.1}/>
    <Glass x={maxX} fromZ={minZ} toZ={GAME_DOOR.fromZ} bottom={1.1}/>
    <Glass x={maxX} fromZ={GAME_DOOR.toZ} toZ={GAME_ROOM.maxZ} bottom={1.1}/>
    {/* Glass partition that makes the lounge its own room */}
    <Wall from={[PARTITION_X, minZ]} to={[PARTITION_X, LOUNGE_PARTITION_END_Z]} height={0.9}/>
    <Glass x={PARTITION_X} fromZ={minZ} toZ={LOUNGE_PARTITION_END_Z} bottom={0.9}/>
    <Wall from={[minX, maxZ]} to={[4.9, maxZ]} height={0.55}/>
    <Wall from={[6.7, maxZ]} to={[maxX, maxZ]} height={0.55}/>
    {/* Glass-topped half wall around the meeting area and a planter row by the lounge */}
    <Wall from={[-3.2, 1]} to={[-3.2, maxZ]} height={0.9}/>
    <RBox position={[-3.2, 1.35, 2.6]} size={[0.06, 0.9, 3.2]} radius={0.01} color="#cfe8ee" opacity={0.3} roughness={0.05}/>
    {[1.3, 2.3, 3.3].map((z) => <Plant key={z} position={[0.9, 0, z]} size={0.8}/>)}
    {/* Windows on the back and left walls */}
    {[-7, -3.6, 1.4, 6.6].map((x) => <Window key={x} position={[x, 1.55, minZ + 0.14]} night={night}/>)}
    {[-3, 0.6].map((z) => <group key={z} rotation={[0, Math.PI / 2, 0]} position={[minX + 0.14, 1.55, z]}><Window position={[0, 0, 0]} width={1.6} night={night}/></group>)}
    {/* Workspace */}
    <MeetingTable position={MEETING_TABLE}/>
    <Bookshelf position={[minX + 0.35, 0, -0.9]} rotation={Math.PI / 2}/>
    <Plant position={[minX + 0.5, 0, -4.6]}/>
    <Plant position={[-0.4, 0, -4.7]} size={0.9}/>
    <WallClock position={[-3.6, 2.35, minZ + 0.14]}/>
    {/* Lounge */}
    <Sofa position={SOFA} rotation={Math.PI}/>
    {/* Armchairs sit exactly behind the lounge seats agents use (LOUNGE_SEATS 2 and 3) */}
    <Armchair position={[2.1, 0, -2.9]} rotation={Math.PI / 2} color="#d9784a"/>
    <Armchair position={[7.1, 0, -2.9]} rotation={-Math.PI / 2} color="#3d7fd6"/>
    <CoffeeTable position={COFFEE_TABLE}/>
    <RBox position={[TV[0], 0.3, TV[2]]} size={[1.8, 0.6, 0.45]} radius={0.03} color="#6b4a32"/>
    <Television position={[TV[0], 1.35, minZ + 0.17]}/>
    <Plant position={[2.1, 0, -4.6]}/>
    {/* Pantry: galon dispenser, fridge and counter */}
    <GalonDispenser position={[maxX - 0.45, 0, -0.4]} rotation={-Math.PI / 2}/>
    <Fridge position={[maxX - 0.5, 0, 0.6]} rotation={-Math.PI / 2}/>
    <PantryCounter position={[maxX - 0.45, 0, 2.6]} rotation={-Math.PI / 2}/>
    {/* Split ACs high on the walls */}
    <AirConditioner position={[-5.3, 2.3, minZ + 0.125]}/>
    <AirConditioner position={[TV[0], 2.3, minZ + 0.125]}/>
    <AirConditioner position={[minX + 0.125, 2.3, 2.6]} rotation={Math.PI / 2}/>
    {/* Office lights: suspended cool-white LED bars */}
    {[...layout.desks.map(([x, , z]): Vec3 => [x, 2.4, z + 0.2]), [MEETING_TABLE[0], 2.3, MEETING_TABLE[2]] as Vec3, [COFFEE_TABLE[0], 2.4, COFFEE_TABLE[2] + 0.4] as Vec3, [8.2, 2.4, 1.2] as Vec3].map((position) => <OfficeLight key={position.join(',')} position={position} night={night}/>)}
    <GameRoom night={night}/>
  </group>
}

function Outdoors({ night, layout }: { night: boolean; layout: OfficeLayout }) {
  // How far the building grew to the left for a larger crew; the grounds grow with it.
  const shift = layout.building.minX + 9.5
  const lawn = useMemo(() => grass([14, 12]), [])
  const road = useMemo(() => asphalt([8, 1]), [])
  const sidewalk = useMemo(() => pavingStones([14, 2]), [])
  const gang = useMemo(() => pavingStones([2, 5]), [])
  return <group>
    <Floor position={[shift / 2, -0.02, 2]} size={[60 - shift, 44]} map={lawn} roughness={1}/>
    <Floor position={[shift / 2, -0.005, 7.1]} size={[34 - shift, 5]} map={sidewalk} roughness={0.9}/>
    <Floor position={[shift / 2, -0.01, 12.1]} size={[60 - shift, 5]} map={road} roughness={0.95}/>
    {/* Path from the entrance to the sidewalk */}
    <Floor position={[5.8, 0, 4.7]} size={[1.8, 1]} map={sidewalk}/>
    {/* Merah Putih by the entrance */}
    <FlagPole position={FLAG}/>
    {/* The gang (alley) left of the building, with the street food out of the main view */}
    <Floor position={[layout.gangCenterX, -0.008, -0.4]} size={[3.6, 10]} map={gang} roughness={0.9}/>
    <group position={layout.baksoCart} rotation={[0, STALL_ROTATION, 0]}>
      <Gerobak position={[0, 0, 0]} night={night}/>
      <Vendor position={[-1.6, 0, 0]} rotation={Math.PI / 2} shirt="#f1f1ec" hat="peci"/>
    </group>
    <group position={layout.kopiBike} rotation={[0, STALL_ROTATION, 0]}>
      <KopiSepeda position={[0, 0, 0]} night={night}/>
      <Vendor position={[-1.35, 0, -0.1]} rotation={Math.PI / 2} shirt="#2f6d8f" hat="cap"/>
    </group>
    {/* AC outdoor units behind the building */}
    <AcOutdoorUnit position={[-5.3, 0, layout.building.minZ - 0.45]} rotation={Math.PI}/>
    <AcOutdoorUnit position={[TV[0] - 1.6, 0, layout.building.minZ - 0.45]} rotation={Math.PI}/>
    <StreetLamp position={[-8, 0, 9.3]} night={night}/>
    <StreetLamp position={[4, 0, 9.3]} night={night}/>
    {[[-12.8 + shift, -7.4, 1.3], [13.5, -7.2, 1.2], [-14.8 + shift, 2.6, 1.1], [18.6, 4.8, 1.3], [-10.5 + shift, 7.5, 1], [12, 8, 1.1], [-2, -8.5, 1.2], [6, -8, 1.1]].map(([x, z, size]) => <Tree key={`${x}${z}`} position={[x, 0, z]} size={size}/>)}
  </group>
}

export function Environment({ night = false, layout }: { night?: boolean; layout: OfficeLayout }) {
  return <group>
    <Building night={night} layout={layout}/>
    <Outdoors night={night} layout={layout}/>
  </group>
}
