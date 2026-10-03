"""Prepare lightweight browser data for the groundwater story animation.

Run from the project root:
    python groundwater-story-map/scripts/prepare_story_data.py

The animation bundle contains only the fields needed by the story. The full
inventory is also split into small, fixed zoom-7 spatial chunks for the future
interactive dashboard.
"""

from __future__ import annotations

import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "groundwater_cleaned.csv"
OUTPUT = ROOT / "groundwater-story-map" / "public" / "data"
TILES = OUTPUT / "tiles"
ZOOM = 7
MAX_FEATURES_PER_FILE = 900

TYPE_CODES = {
    "Protected dug well": "pdw",
    "Protected spring": "ps",
    "Borehole or tubewell": "bh",
    "Unprotected spring": "us",
    "Unprotected dug well": "udw",
}


def truthy(value: str | None) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    lat = max(-85.05112878, min(85.05112878, lat))
    scale = 2**zoom
    x = int((lon + 180.0) / 360.0 * scale)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * scale)
    return x, y


def compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TILES.mkdir(parents=True, exist_ok=True)

    records: list[list[object]] = []
    by_tile: dict[tuple[int, int], list[dict[str, object]]] = defaultdict(list)
    county_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    valid_depths: list[float] = []
    bounds = [180.0, 90.0, -180.0, -90.0]

    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                lon = float(row["longitude"])
                lat = float(row["latitude"])
            except (TypeError, ValueError):
                continue

            source_type = row.get("Type", "Unknown").strip() or "Unknown"
            code = TYPE_CODES.get(source_type, "other")
            county = row.get("admin_1", "Unknown").strip() or "Unknown"
            name = row.get("name", "").strip()
            original_id = row.get("original_id", "").strip()

            depth: float | None = None
            if truthy(row.get("has_depth")) and not truthy(row.get("depth_review_flag")):
                try:
                    depth = round(float(row["well_depth"]), 1)
                    valid_depths.append(depth)
                except (TypeError, ValueError):
                    depth = None

            try:
                update_year: int | None = int(row.get("year", ""))
            except (TypeError, ValueError):
                update_year = None

            try:
                update_year_part, update_month_part = row.get("month", "").split("-", 1)
                update_month_index: int | None = int(update_year_part) * 12 + int(update_month_part) - 1
            except (AttributeError, TypeError, ValueError):
                update_month_index = None

            try:
                elevation: float | None = round(float(row.get("elevation", "")), 1)
            except (TypeError, ValueError):
                elevation = None

            # Compact browser tuple: longitude, latitude, type, county, depth,
            # record-update year, recorded elevation and record-update month.
            # The update date is not a construction date. Elevation is a
            # fallback when terrain tiles have not yet loaded in the 3D view.
            records.append([round(lon, 6), round(lat, 6), code, county, depth, update_year, elevation, update_month_index])
            county_counts[county] += 1
            type_counts[source_type] += 1
            bounds[0] = min(bounds[0], lon)
            bounds[1] = min(bounds[1], lat)
            bounds[2] = max(bounds[2], lon)
            bounds[3] = max(bounds[3], lat)

            x, y = tile_xy(lon, lat, ZOOM)
            properties: dict[str, object] = {
                "id": original_id,
                "n": name,
                "t": code,
                "c": county,
            }
            if depth is not None:
                properties["d"] = depth
            by_tile[(x, y)].append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                    "properties": properties,
                }
            )

    sorted_depths = sorted(valid_depths)
    median_depth = (
        sorted_depths[len(sorted_depths) // 2]
        if len(sorted_depths) % 2
        else (sorted_depths[len(sorted_depths) // 2 - 1] + sorted_depths[len(sorted_depths) // 2]) / 2
    )
    well_types = {"Protected dug well", "Borehole or tubewell", "Unprotected dug well"}
    well_count = sum(type_counts[name] for name in well_types)
    western_count = county_counts["Kakamega"] + county_counts["Vihiga"]

    summary = {
        "total": len(records),
        "counties": len(county_counts),
        "depthCount": len(valid_depths),
        "depthShare": round(100 * len(valid_depths) / len(records), 1),
        "medianDepth": round(median_depth, 1),
        "wellCount": well_count,
        "westernCount": western_count,
        "westernShare": round(100 * western_count / len(records), 1),
        "bounds": [round(value, 6) for value in bounds],
        "countyCounts": dict(county_counts.most_common()),
        "typeCounts": dict(type_counts.most_common()),
    }
    bundle = {"summary": summary, "records": records}
    (OUTPUT / "animation-points.json").write_text(compact_json(bundle) + "\n", encoding="utf-8")

    tile_index: list[dict[str, object]] = []
    for (x, y), features in sorted(by_tile.items()):
        for part, start in enumerate(range(0, len(features), MAX_FEATURES_PER_FILE), start=1):
            subset = features[start : start + MAX_FEATURES_PER_FILE]
            filename = f"z{ZOOM}-{x}-{y}-p{part}.geojson"
            payload = {"type": "FeatureCollection", "features": subset}
            (TILES / filename).write_text(compact_json(payload), encoding="utf-8")
            tile_index.append(
                {
                    "z": ZOOM,
                    "x": x,
                    "y": y,
                    "part": part,
                    "count": len(subset),
                    "file": filename,
                }
            )

    index = {
        "format": "fixed spatial GeoJSON chunks",
        "zoom": ZOOM,
        "maxFeaturesPerFile": MAX_FEATURES_PER_FILE,
        "totalFeatures": len(records),
        "chunks": tile_index,
    }
    (TILES / "tile-index.json").write_text(compact_json(index) + "\n", encoding="utf-8")
    (OUTPUT / "story-summary.json").write_text(compact_json(summary) + "\n", encoding="utf-8")

    print(f"Prepared {len(records):,} records in {len(tile_index):,} spatial chunks")
    print(f"Animation bundle: {OUTPUT / 'animation-points.json'}")


if __name__ == "__main__":
    main()
