#!/usr/bin/env python3
"""Rasterises Natural Earth 50 m land into a 1024x1024 Web Mercator bitmask (api/land.bin).

Row-major, most significant bit first, 1 = land. The worker uses it to weight the drawing queue
so land gets drawn before open ocean. Source: nvkelso/natural-earth-vector, geojson/ne_50m_land.geojson.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

N = 1024
SS = 4  # rasterise at 4x, then call a pixel land if at least half of it is land
ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.cache' / 'ne_50m_land.geojson'
OUT = ROOT / 'api' / 'land.bin'


def px(lon, lat, size):
    lat = max(-85.0511, min(85.0511, lat))
    r = math.radians(lat)
    x = (lon + 180) / 360 * size
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * size
    return x, y


def main():
    size = N * SS
    img = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(img)
    for feature in json.loads(SRC.read_text())['features']:
        geom = feature['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        for rings in polys:
            for i, ring in enumerate(rings):
                draw.polygon([px(lon, lat, size) for lon, lat in ring], fill=0 if i else 255)
    small = img.resize((N, N), Image.BOX)
    bits = bytearray(N * N // 8)
    land = 0
    for i, v in enumerate(small.get_flattened_data()):
        if v >= 128:
            bits[i >> 3] |= 0x80 >> (i & 7)
            land += 1
    OUT.write_bytes(bytes(bits))
    small.point(lambda v: 255 if v >= 128 else 0).save(ROOT / '.cache' / 'land-preview.png')
    print(f'{OUT.relative_to(ROOT)}: {len(bits)} bytes, {land / (N * N):.1%} land')


if __name__ == '__main__':
    main()
