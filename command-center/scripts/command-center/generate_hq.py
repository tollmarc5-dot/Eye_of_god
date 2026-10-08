#!/usr/bin/env python3
"""
Generates the AI Command Center headquarters: four pixel-art furniture assets
(server rack, holo table, data wall, neon sign) and the bundled default layout
`default-layout-2.json` with eight configurable zones (layout Areas).

Reproducible: run from the repo root with `python3 scripts/command-center/generate_hq.py`.
Everything here is static decoration; nothing in the art depicts agent state —
live state comes only from the runtime (status rings, monitor light, PCs that
switch on when a real agent works at them).
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, 'webview-ui', 'public', 'assets')
FURNITURE = os.path.join(ASSETS, 'furniture')

# ── Palette ─────────────────────────────────────────────────────
VOID = (0, 0, 0, 0)
OUTLINE = (4, 6, 18, 255)
METAL_D = (14, 18, 42, 255)
METAL = (24, 30, 66, 255)
METAL_L = (44, 54, 108, 255)
METAL_HL = (74, 88, 160, 255)
SCREEN = (6, 12, 30, 255)
CYAN = (46, 230, 255, 255)
CYAN_D = (20, 110, 150, 255)
BLUE = (61, 123, 255, 255)
VIOLET = (166, 107, 255, 255)
MAGENTA = (255, 63, 209, 255)
GREEN = (63, 242, 160, 255)
AMBER = (255, 176, 32, 255)


def canvas(w, h):
    return Image.new('RGBA', (w, h), VOID)


def rect(img, x, y, w, h, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if 0 <= xx < img.width and 0 <= yy < img.height:
                img.putpixel((xx, yy), color)


def outline(img, x, y, w, h, color):
    rect(img, x, y, w, 1, color)
    rect(img, x, y + h - 1, w, 1, color)
    rect(img, x, y, 1, h, color)
    rect(img, x + w - 1, y, 1, h, color)


def server_rack():
    img = canvas(16, 32)
    rect(img, 1, 2, 14, 29, METAL_D)
    outline(img, 1, 2, 14, 29, OUTLINE)
    rect(img, 2, 3, 12, 1, METAL_HL)
    leds = [CYAN, GREEN, BLUE, CYAN, VIOLET, GREEN, CYAN]
    for i, row in enumerate(range(5, 28, 3)):
        rect(img, 3, row, 10, 2, METAL)
        rect(img, 3, row, 10, 1, METAL_L)
        img.putpixel((4, row + 1), leds[i % len(leds)])
        img.putpixel((6, row + 1), leds[(i + 2) % len(leds)])
        rect(img, 9, row + 1, 3, 1, CYAN_D)
    rect(img, 2, 29, 12, 1, MAGENTA)
    return img


def holo_table():
    img = canvas(32, 32)
    rect(img, 2, 10, 28, 18, METAL)
    rect(img, 3, 9, 26, 1, METAL_L)
    outline(img, 2, 10, 28, 18, OUTLINE)
    rect(img, 4, 12, 24, 14, SCREEN)
    outline(img, 4, 12, 24, 14, CYAN_D)
    for x in range(6, 27, 4):
        rect(img, x, 13, 1, 12, (20, 60, 110, 255))
    for y in range(14, 25, 3):
        rect(img, 5, y, 22, 1, (20, 60, 110, 255))
    # hologram rings floating over the table
    for (cx, cy, r, col) in [(16, 8, 6, CYAN), (16, 8, 3, MAGENTA)]:
        for a in range(0, 360, 12):
            import math
            x = int(round(cx + r * math.cos(math.radians(a))))
            y = int(round(cy + r * 0.45 * math.sin(math.radians(a))))
            img.putpixel((x, y), col)
    rect(img, 15, 9, 2, 10, (46, 230, 255, 110))
    rect(img, 3, 27, 26, 1, CYAN)
    return img


def data_wall():
    img = canvas(48, 32)
    rect(img, 0, 2, 48, 26, METAL_D)
    outline(img, 0, 2, 48, 26, OUTLINE)
    panels = [(2, 4, 14, 10, CYAN), (17, 4, 14, 10, VIOLET), (32, 4, 14, 10, BLUE),
              (2, 15, 21, 11, MAGENTA), (24, 15, 22, 11, CYAN)]
    for (x, y, w, h, col) in panels:
        rect(img, x, y, w, h, SCREEN)
        outline(img, x, y, w, h, METAL_L)
        dim = tuple(int(c * 0.45) for c in col[:3]) + (255,)
        for i in range(1, w - 1, 3):
            rect(img, x + i, y + h - 2 - (i * 7 % (h - 3)), 1, (i * 7 % (h - 3)) + 1, dim)
        rect(img, x + 1, y + 1, w - 2, 1, col)
    rect(img, 0, 28, 48, 1, CYAN)
    return img


def neon_sign():
    img = canvas(32, 16)
    rect(img, 1, 4, 30, 8, METAL_D)
    outline(img, 1, 4, 30, 8, OUTLINE)
    rect(img, 3, 6, 26, 1, MAGENTA)
    rect(img, 3, 9, 26, 1, CYAN)
    for x in range(4, 28, 5):
        rect(img, x, 7, 2, 2, VIOLET)
    return img


def write_asset(asset_id, name, category, img, manifest_extra):
    folder = os.path.join(FURNITURE, asset_id)
    os.makedirs(folder, exist_ok=True)
    img.save(os.path.join(folder, f'{asset_id}.png'))
    manifest = {
        'id': asset_id,
        'name': name,
        'category': category,
        'type': 'asset',
        'canPlaceOnWalls': False,
        'canPlaceOnSurfaces': False,
        'backgroundTiles': 0,
        'width': img.width,
        'height': img.height,
        'footprintW': img.width // 16,
        'footprintH': img.height // 16,
    }
    manifest.update(manifest_extra)
    with open(os.path.join(folder, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


# ── Layout ──────────────────────────────────────────────────────
COLS, ROWS = 46, 30
WALL, FLOOR, VOID_T = 0, 1, 255

ZONES = [
    # label, colour, (c0, r0, c1, r1) inclusive interior
    ('RESEARCH', '#a66bff', (1, 2, 13, 11)),
    ('COMMAND CENTER', '#2ee6ff', (15, 2, 30, 11)),
    ('DESIGN', '#ff3fd1', (32, 2, 44, 11)),
    ('ENGINEERING', '#3d7bff', (1, 13, 21, 21)),
    ('DATA', '#3ff2a0', (23, 13, 33, 21)),
    ('AUTOMATION', '#ffb020', (35, 13, 44, 21)),
    ('MARKETING', '#ff6b9a', (1, 23, 21, 28)),
    ('OPERATIONS', '#6be3ff', (23, 23, 44, 28)),
]

# Doorways punched through partition walls (col, row).
DOORS = [
    (14, 6), (14, 7), (31, 6), (31, 7),            # top band
    (6, 12), (7, 12), (22, 12), (23, 12), (39, 12), (40, 12),
    (22, 16), (22, 17), (34, 16), (34, 17),        # middle band
    (10, 22), (11, 22), (28, 22), (29, 22), (38, 22), (39, 22),
    (22, 25), (22, 26),                            # bottom band
]

FLOOR_BASE = {'h': 230, 's': 30, 'b': -82, 'c': -5, 'colorize': True}
ZONE_FLOOR_HUE = {
    'RESEARCH': 255, 'COMMAND CENTER': 205, 'DESIGN': 290, 'ENGINEERING': 225,
    'DATA': 170, 'AUTOMATION': 35, 'MARKETING': 330, 'OPERATIONS': 195,
}
WALL_COLOR = {'h': 238, 's': 50, 'b': -100, 'c': -45, 'colorize': True}
DESK_COLOR = {'h': 228, 's': 40, 'b': -50, 'c': 15, 'colorize': True}
CHAIR_COLOR = {'h': 265, 's': 55, 'b': -38, 'c': 10, 'colorize': True}


def build_layout():
    tiles = [VOID_T] * (COLS * ROWS)
    colors = [None] * (COLS * ROWS)
    area_tiles = [None] * (COLS * ROWS)
    idx = lambda c, r: r * COLS + c

    # Outer shell + partitions are walls; zone interiors are floor.
    for r in range(1, ROWS):
        for c in range(0, COLS):
            tiles[idx(c, r)] = WALL
            colors[idx(c, r)] = WALL_COLOR
    for label, _, (c0, r0, c1, r1) in ZONES:
        hue = ZONE_FLOOR_HUE[label]
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                tiles[idx(c, r)] = FLOOR
                colors[idx(c, r)] = {**FLOOR_BASE, 'h': hue}
                area_tiles[idx(c, r)] = label
    for (c, r) in DOORS:
        tiles[idx(c, r)] = FLOOR
        colors[idx(c, r)] = {**FLOOR_BASE}

    furniture = []
    counter = [0]

    def place(type_, col, row, color=None):
        counter[0] += 1
        item = {'uid': f'hq-{counter[0]:03d}', 'type': type_, 'col': col, 'row': row}
        if color:
            item['color'] = color
        furniture.append(item)

    def workstation(col, row, dual=True):
        """Desk (3x2) with monitors on it and one chair below, facing the screens."""
        place('DESK_FRONT', col, row, DESK_COLOR)
        place('PC_FRONT_OFF', col + 1 if not dual else col, row)
        if dual:
            place('PC_FRONT_OFF', col + 2, row)
        place('CUSHIONED_CHAIR_BACK', col + 1, row + 2, CHAIR_COLOR)

    # COMMAND CENTER — data wall, holo table, command consoles facing it.
    place('DATA_WALL', 17, 0)
    place('DATA_WALL', 26, 0)
    place('NEON_SIGN', 21, 1)
    place('HOLO_TABLE', 22, 4)
    for col in (16, 20, 24, 28):
        workstation(col, 8, dual=col in (20, 24))

    # RESEARCH — analysis stations + reference shelves.
    place('DOUBLE_BOOKSHELF', 2, 1)
    place('DOUBLE_BOOKSHELF', 4, 1)
    place('WHITEBOARD', 9, 0)
    for (col, row) in ((2, 4), (7, 4), (2, 8), (7, 8)):
        workstation(col, row)
    place('LARGE_PLANT', 12, 9)

    # DESIGN — creative stations, whiteboard, plants.
    place('WHITEBOARD', 34, 0)
    place('LARGE_PAINTING', 39, 0)
    for (col, row) in ((33, 4), (38, 4), (33, 8), (38, 8)):
        workstation(col, row)
    place('PLANT_2', 43, 3)

    # ENGINEERING — the big floor: three rows of dual-monitor stations.
    place('NEON_SIGN', 9, 12)
    for row in (14, 18):
        for col in (2, 7, 12, 17):
            workstation(col, row)

    # DATA — analytics stations.
    place('DATA_WALL', 26, 11)
    for (col, row) in ((24, 14), (29, 14), (24, 18), (29, 18)):
        workstation(col, row)

    # AUTOMATION — server room.
    for col in (36, 37, 38, 41, 42, 43):  # 39-40 stay clear: doorway from DESIGN
        place('SERVER_RACK', col, 13)
    for col in range(36, 44, 2):
        place('SERVER_RACK', col, 17)
    workstation(35, 19, dual=False)
    workstation(41, 19, dual=False)

    # MARKETING — campaign stations + lounge corner.
    place('NEON_SIGN', 4, 22)
    for (col, row) in ((2, 24), (7, 24), (12, 24)):
        workstation(col, row)
    place('SOFA_FRONT', 17, 24, CHAIR_COLOR)
    place('COFFEE_TABLE', 17, 26)

    # OPERATIONS — monitoring stations + racks.
    place('DATA_WALL', 31, 21)
    for (col, row) in ((24, 24), (29, 24), (36, 24)):
        workstation(col, row)
    place('SERVER_RACK', 42, 23)
    place('SERVER_RACK', 43, 23)
    place('PLANT', 41, 27)

    areas = [{'label': label, 'color': color} for label, color, _ in ZONES]
    return {
        'version': 1,
        'cols': COLS,
        'rows': ROWS,
        'layoutRevision': 2,
        'tiles': tiles,
        'tileColors': colors,
        'furniture': furniture,
        'areas': areas,
        'areaTiles': area_tiles,
        'pets': [],
    }


def main():
    write_asset('SERVER_RACK', 'Server Rack', 'electronics', server_rack(), {'backgroundTiles': 1})
    write_asset('HOLO_TABLE', 'Holo Table', 'desks', holo_table(), {'backgroundTiles': 1})
    write_asset('DATA_WALL', 'Data Wall', 'wall', data_wall(), {'canPlaceOnWalls': True})
    write_asset('NEON_SIGN', 'Neon Sign', 'wall', neon_sign(), {'canPlaceOnWalls': True})
    layout = build_layout()
    path = os.path.join(ASSETS, 'default-layout-2.json')
    with open(path, 'w') as f:
        json.dump(layout, f, separators=(',', ':'))
        f.write('\n')
    seats = sum(1 for f in layout['furniture'] if f['type'].startswith('CUSHIONED_CHAIR'))
    print(f'wrote 4 assets and {path} ({COLS}x{ROWS}, {len(layout["furniture"])} items, {seats} seats)')


if __name__ == '__main__':
    main()
