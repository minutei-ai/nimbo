"""Generate the original synthetic multi-script fixture font with fonttools==4.60.1.

Latin, Greek, Cyrillic, Hebrew and Arabic glyphs have distinct advances. Arabic
joining forms and Latin kerning only apply when shaping uses the right script,
so measured widths expose itemization errors. The engine does not depend on
Python or FontTools.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen

characters = {
    0x20: ("space", 250), 0x31: ("one", 520), 0x41: ("A", 600), 0x42: ("B", 700),
    0x391: ("Alpha", 610), 0x3B1: ("alpha", 540), 0x416: ("Zhe", 830), 0x436: ("zhe", 640),
    0x5D0: ("alef-hb", 590), 0x5D1: ("bet-hb", 570),
    0x627: ("alef-ar", 270), 0x628: ("beh-ar", 400), 0x644: ("lam-ar", 350),
}
forms = {
    "alef-ar.fina": 290, "beh-ar.init": 300, "beh-ar.medi": 260, "beh-ar.fina": 420,
    "lam-ar.init": 250, "lam-ar.medi": 230, "lam-ar.fina": 360,
}
widths = {".notdef": 500, **{name: advance for name, advance in characters.values()}, **forms}
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder(list(widths))
builder.setupCharacterMap({code: name for code, (name, _) in characters.items()})
glyphs = {}
for name, advance in widths.items():
    pen = TTGlyphPen(None)
    if name != "space":
        pen.moveTo((20, 0))
        pen.lineTo((advance - 20, 0))
        pen.lineTo((advance - 20, 700))
        pen.lineTo((20, 700))
        pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: (advance, 20) for name, advance in widths.items()})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "Nimbo Scripts", "styleName": "Regular",
    "uniqueFontIdentifier": "NimboScripts-Regular-1", "fullName": "Nimbo Scripts Regular",
    "psName": "NimboScripts-Regular", "version": "Version 1.0"})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.font.recalcTimestamp = False
builder.font["head"].created = 2082844800
builder.font["head"].modified = 2082844800
addOpenTypeFeaturesFromString(builder.font, """
languagesystem DFLT dflt; languagesystem latn dflt; languagesystem arab dflt;
feature kern { script latn; pos B A -50; } kern;
feature init { script arab; sub beh-ar by beh-ar.init; sub lam-ar by lam-ar.init; } init;
feature medi { script arab; sub beh-ar by beh-ar.medi; sub lam-ar by lam-ar.medi; } medi;
feature fina { script arab; sub alef-ar by alef-ar.fina; sub beh-ar by beh-ar.fina; sub lam-ar by lam-ar.fina; } fina;
""")
builder.save(Path(__file__).resolve().parent.parent / "crates/engine/tests/fixtures/synthetic-scripts-font.ttf")
