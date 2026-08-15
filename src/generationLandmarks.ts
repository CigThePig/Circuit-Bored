import type { FloorTreatmentZone, LandmarkImportance, LandmarkKind, MapLandmark } from "./environment.ts";
import { getTile, setTile, type GameMap, type TileType } from "./map.ts";
import {
  paintBrokenRoom,
  paintCoverCluster,
  paintRect,
  paintRoomBoundary,
  paintWallRun,
  type Point,
  type Rect,
} from "./generationMotifs.ts";

export type LandmarkPlacement = {
  landmark: MapLandmark;
  floorZone: FloorTreatmentZone;
};

function landmark(
  id: string,
  name: string,
  kind: LandmarkKind,
  importance: LandmarkImportance,
  rect: Rect,
  treatment: FloorTreatmentZone["treatment"],
): LandmarkPlacement {
  return {
    landmark: { id, name, kind, importance, rect: { ...rect } },
    floorZone: { id: `${id}-floor`, treatment, rect: { ...rect } },
  };
}

function paintIfFloor(map: GameMap, point: Point, tile: TileType): void {
  if (getTile(map, point.x, point.y) === "floor") setTile(map, point.x, point.y, tile);
}

export function paintFurnaceBlock(map: GameMap, rect: Rect, id = "furnace"): LandmarkPlacement {
  const core = { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 };
  paintRect(map, core, "wall");
  for (let x = rect.x; x < rect.x + rect.width; x += 2) {
    paintIfFloor(map, { x, y: rect.y + rect.height - 1 }, "half_cover");
  }
  return landmark(id, "Furnace Room", "furnace_block", "major", rect, "machine_bay");
}

export function paintCoolantTanks(map: GameMap, rect: Rect, id = "coolant-tanks"): LandmarkPlacement {
  const tankW = Math.max(2, Math.floor((rect.width - 2) / 2));
  paintRect(map, { x: rect.x + 1, y: rect.y + 1, width: tankW, height: rect.height - 2 }, "wall");
  paintRect(map, { x: rect.x + rect.width - tankW - 1, y: rect.y + 1, width: tankW, height: rect.height - 2 }, "wall");
  paintIfFloor(map, { x: rect.x, y: rect.y + 1 }, "half_cover");
  paintIfFloor(map, { x: rect.x + rect.width - 1, y: rect.y + rect.height - 2 }, "half_cover");
  return landmark(id, "Coolant Tanks", "coolant_tanks", "major", rect, "machine_bay");
}

export function paintProcessingLine(map: GameMap, rect: Rect, id = "processing-line"): LandmarkPlacement {
  const y = rect.y + Math.floor(rect.height / 2);
  paintWallRun(map, { x: rect.x, y }, rect.width, true, [3, rect.width - 4], 2);
  for (const x of [rect.x + 1, rect.x + Math.floor(rect.width / 2), rect.x + rect.width - 2]) {
    paintIfFloor(map, { x, y: y + 1 }, "half_cover");
  }
  return landmark(id, "Processing Line", "processing_line", "major", rect, "service_lane");
}

export function paintLoadingBay(map: GameMap, rect: Rect, id = "loading-bay", name = "Loading Bay"): LandmarkPlacement {
  paintWallRun(map, { x: rect.x, y: rect.y }, rect.width, true, [2, rect.width - 3], 1);
  paintCoverCluster(map, { x: rect.x + 1, y: rect.y + 2 }, "corner", 0);
  paintCoverCluster(map, { x: rect.x + rect.width - 2, y: rect.y + rect.height - 2 }, "pair", 2);
  return landmark(id, name, "loading_bay", "secondary", rect, "loading_apron");
}

export function paintServerVault(map: GameMap, rect: Rect, id = "server-vault"): LandmarkPlacement {
  const midX = rect.x + Math.floor(rect.width / 2);
  const midY = rect.y + Math.floor(rect.height / 2);
  paintRoomBoundary(map, rect, [
    { x: midX, y: rect.y }, { x: midX - 1, y: rect.y },
    { x: midX, y: rect.y + rect.height - 1 }, { x: midX - 1, y: rect.y + rect.height - 1 },
    { x: rect.x, y: midY }, { x: rect.x + rect.width - 1, y: midY },
  ]);
  paintRect(map, { x: midX - 1, y: midY - 2, width: 2, height: 4 }, "wall");
  return landmark(id, "Server Vault", "server_vault", "major", rect, "vault_grid");
}

export function paintDataCore(map: GameMap, rect: Rect, id = "data-core"): LandmarkPlacement {
  const core = { x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 };
  paintRect(map, core, "wall");
  for (const point of [
    { x: rect.x + 1, y: rect.y + 1 },
    { x: rect.x + rect.width - 2, y: rect.y + 1 },
    { x: rect.x + 1, y: rect.y + rect.height - 2 },
    { x: rect.x + rect.width - 2, y: rect.y + rect.height - 2 },
  ]) paintIfFloor(map, point, "half_cover");
  return landmark(id, "Processing Core", "data_core", "major", rect, "vault_grid");
}

export function paintSecurityCheckpoint(map: GameMap, rect: Rect, id = "checkpoint"): LandmarkPlacement {
  const y = rect.y + 1;
  paintWallRun(map, { x: rect.x, y }, rect.width, true, [2, rect.width - 4], 2);
  paintIfFloor(map, { x: rect.x + 1, y: y - 1 }, "half_cover");
  paintIfFloor(map, { x: rect.x + rect.width - 2, y: y + 1 }, "half_cover");
  return landmark(id, "Security Checkpoint", "security_checkpoint", "secondary", rect, "checkpoint_threshold");
}

export function paintServerRows(map: GameMap, rect: Rect, id = "server-rows"): LandmarkPlacement {
  const left = rect.x + 1;
  const right = rect.x + rect.width - 2;
  paintWallRun(map, { x: left, y: rect.y }, rect.height, false, [3, rect.height - 3], 1);
  paintWallRun(map, { x: right, y: rect.y }, rect.height, false, [2, rect.height - 4], 1);
  return landmark(id, "Server Hall", "server_rows", "secondary", rect, "server_hall");
}

export function paintCollapsedRoom(map: GameMap, rect: Rect, id = "collapsed-room"): LandmarkPlacement {
  paintBrokenRoom(map, rect, "e");
  paintRect(map, { x: rect.x + 1, y: rect.y + 1, width: 3, height: 3 }, "wall");
  paintCoverCluster(map, { x: rect.x + rect.width - 3, y: rect.y + rect.height - 3 }, "stagger", 1);
  return landmark(id, "Collapsed Bay", "collapsed_room", "major", rect, "collapsed_deck");
}

export function paintScrapHeap(map: GameMap, rect: Rect, id = "scrap-heap"): LandmarkPlacement {
  const cx = rect.x + Math.floor(rect.width / 2);
  const cy = rect.y + Math.floor(rect.height / 2);
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) {
      const distance = Math.abs(x - cx) + Math.abs(y - cy);
      if (distance <= 2) setTile(map, x, y, "wall");
      else if (distance === 3 && (x + y) % 2 === 0) paintIfFloor(map, { x, y }, "half_cover");
    }
  }
  return landmark(id, "Scrap Heap", "scrap_heap", "major", rect, "salvage_wear");
}

export function paintWreckedMachinery(map: GameMap, rect: Rect, id = "wrecked-machine", name = "Wrecked Machinery"): LandmarkPlacement {
  const y = rect.y + Math.floor(rect.height / 2);
  paintWallRun(map, { x: rect.x + 1, y }, rect.width - 2, true, [2, rect.width - 5], 1);
  paintRect(map, { x: rect.x + Math.floor(rect.width / 2) - 1, y: y - 1, width: 3, height: 3 }, "wall");
  paintCoverCluster(map, { x: rect.x, y: rect.y }, "pocket", 0);
  return landmark(id, name, "wrecked_machinery", "secondary", rect, "salvage_wear");
}

export function paintBreachedCorridor(map: GameMap, rect: Rect, id = "breached-corridor"): LandmarkPlacement {
  paintWallRun(map, { x: rect.x, y: rect.y }, rect.width, true, [3, rect.width - 5], 2);
  paintWallRun(map, { x: rect.x, y: rect.y + rect.height - 1 }, rect.width, true, [5, rect.width - 3], 2);
  paintIfFloor(map, { x: rect.x + Math.floor(rect.width / 2), y: rect.y + 1 }, "half_cover");
  return landmark(id, "Breached Corridor", "breached_corridor", "secondary", rect, "breach_scars");
}
