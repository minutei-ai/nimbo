"""Generate the original synthetic OpenType shaping fixture with fonttools==4.60.1.

Run in a Python environment with the pinned development dependency installed.
The engine does not depend on Python or FontTools.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen

builder = FontBuilder(1000, isTTF=True)
widths = {".notdef": 500, "space": 250, "A": 600, "B": 700, "Euro": 800, "ABlig": 900, "e": 550, "eacute": 550, "acutecomb": 0}
builder.setupGlyphOrder(list(widths))
builder.setupCharacterMap({32: "space", 65: "A", 66: "B", 8364: "Euro", 101:"e", 233:"eacute", 769:"acutecomb"})
glyphs = {}
for name, advance in widths.items():
    pen = TTGlyphPen(None)
    if name != "space":
        pen.moveTo((50, 0))
        pen.lineTo((advance - 50, 0))
        pen.lineTo((advance - 50, 700))
        pen.lineTo((50, 700))
        pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: (advance, 50) for name, advance in widths.items()})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "Nimbo Synthetic", "styleName": "Regular",
    "uniqueFontIdentifier": "NimboSynthetic-Regular-1", "fullName": "Nimbo Synthetic Regular",
    "psName": "NimboSynthetic-Regular", "version": "Version 1.0"})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.font.recalcTimestamp = False
builder.font["head"].created = 2082844800
builder.font["head"].modified = 2082844800
addOpenTypeFeaturesFromString(builder.font, "languagesystem DFLT dflt; languagesystem latn dflt; feature liga { sub A B by ABlig; } liga; feature kern { pos B A -50; } kern;")
builder.save(Path(__file__).resolve().parent.parent / "crates/engine/tests/fixtures/synthetic-shaping-font.ttf")
