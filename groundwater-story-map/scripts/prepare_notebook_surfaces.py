"""Build lightweight H3 surfaces used by the MapLibre notebook-output views."""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
from scipy.spatial import cKDTree


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "groundwater_cleaned.csv"
BOUNDARY = ROOT / "gadm36_KEN_1.shp"
OUTPUT = ROOT / "groundwater-story-map" / "public" / "data" / "notebook-surfaces.geojson"
H3_RESOLUTION = 5
MIN_DEPTH_COUNT = 5
MAX_HEIGHT = 70_000


def truthy(value: str | None) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def xyz(latitudes: np.ndarray, longitudes: np.ndarray, radius: float = 6371.0) -> np.ndarray:
    latitudes = np.radians(latitudes.astype(float))
    longitudes = np.radians(longitudes.astype(float))
    return np.c_[
        radius * np.cos(latitudes) * np.cos(longitudes),
        radius * np.cos(latitudes) * np.sin(longitudes),
        radius * np.sin(latitudes),
    ]


def polygon(hex_id: str) -> dict[str, object]:
    ring = [[round(lon, 6), round(lat, 6)] for lat, lon in h3.cell_to_boundary(hex_id)]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def main() -> None:
    stats: dict[str, dict[str, object]] = defaultdict(lambda: {"records": 0, "depths": [], "elevations": []})
    latitudes: list[float] = []
    longitudes: list[float] = []

    with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (TypeError, ValueError):
                continue
            latitudes.append(lat)
            longitudes.append(lon)
            cell = h3.latlng_to_cell(lat, lon, H3_RESOLUTION)
            entry = stats[cell]
            entry["records"] = int(entry["records"]) + 1
            if truthy(row.get("has_depth")) and not truthy(row.get("depth_review_flag")):
                try:
                    entry["depths"].append(float(row["well_depth"]))
                except (TypeError, ValueError):
                    pass
            try:
                entry["elevations"].append(float(row["elevation"]))
            except (TypeError, ValueError):
                pass

    counties = gpd.read_file(BOUNDARY).to_crs("EPSG:4326")
    try:
        nation = counties.geometry.union_all()
    except AttributeError:
        nation = counties.geometry.unary_union
    nation_cells = set(h3.geo_to_cells(nation.__geo_interface__, H3_RESOLUTION))
    all_cells = nation_cells | set(stats)

    source_tree = cKDTree(xyz(np.asarray(latitudes), np.asarray(longitudes)))
    centres = {cell: h3.cell_to_latlng(cell) for cell in all_cells}
    nation_order = sorted(nation_cells)
    nation_centres = np.asarray([centres[cell] for cell in nation_order])
    gap_distances, _ = source_tree.query(xyz(nation_centres[:, 0], nation_centres[:, 1]))
    gaps = dict(zip(nation_order, gap_distances.tolist()))
    gap_high = float(np.quantile(gap_distances, 0.97))

    measured_medians = [
        float(np.median(entry["depths"]))
        for entry in stats.values()
        if len(entry["depths"]) >= MIN_DEPTH_COUNT
    ]
    depth_low, depth_high = np.quantile(measured_medians, [0.05, 0.95])
    maximum_records = max(int(entry["records"]) for entry in stats.values())

    features: list[dict[str, object]] = []
    for cell in sorted(all_cells):
        entry = stats.get(cell, {"records": 0, "depths": [], "elevations": []})
        records = int(entry["records"])
        depths = entry["depths"]
        depth_count = len(depths)
        depth_ok = depth_count >= MIN_DEPTH_COUNT
        median_depth = float(np.median(depths)) if depths else None
        median_elevation = float(np.median(entry["elevations"])) if entry["elevations"] else None
        density_score = math.sqrt(records / maximum_records) if records else 0.0
        depth_score = (
            float(np.clip((median_depth - depth_low) / max(depth_high - depth_low, 1e-9), 0, 1))
            if depth_ok and median_depth is not None else 0.0
        )
        gap_km = gaps.get(cell)
        gap_score = min(gap_km / gap_high, 1.0) if gap_km is not None else 0.0
        properties = {
            "hex": cell,
            "records": records,
            "depthCount": depth_count,
            "depthOk": depth_ok,
            "medianDepth": round(median_depth, 1) if median_depth is not None else None,
            "medianElevation": round(median_elevation) if median_elevation is not None else None,
            "densityScore": round(density_score, 6),
            "densityHeight": round(3000 + (MAX_HEIGHT - 3000) * density_score) if records else 0,
            "depthScore": round(depth_score, 6),
            "depthHeight": round(4000 + (MAX_HEIGHT - 4000) * depth_score) if depth_ok else 2000,
            "gapKm": round(gap_km, 1) if gap_km is not None else None,
            "gapScore": round(gap_score, 6),
            "gapHeight": round(2000 + (MAX_HEIGHT - 2000) * gap_score) if gap_km is not None else 0,
            "insideKenya": cell in nation_cells,
        }
        features.append({"type": "Feature", "geometry": polygon(cell), "properties": properties})

    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "h3Resolution": H3_RESOLUTION,
            "minimumDepthSample": MIN_DEPTH_COUNT,
            "maximumRecords": maximum_records,
            "depthRange": [round(float(depth_low), 1), round(float(depth_high), 1)],
            "gap97Km": round(gap_high, 1),
            "featureCount": len(features),
        },
        "features": features,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Prepared {len(features):,} H3 notebook surface cells: {OUTPUT}")


if __name__ == "__main__":
    main()
