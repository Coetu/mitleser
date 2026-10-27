"""Mitleser – App-Symbole erzeugen (PNG-Dateien im Ordner icons/).

Aufruf im Projektordner (einmalig oder nach Änderungen am Motiv):
    C:\\Users\\maika\\anaconda3\\python.exe -I tools/make_icons.py

Erzeugt:
    icons/icon-192.png           192 x 192, abgerundete Ecken, außen transparent (Browser, Android)
    icons/icon-512.png           512 x 512, abgerundete Ecken, außen transparent
    icons/icon-maskable-512.png  512 x 512 randlos, Motiv in der „sicheren Zone“ (Android schneidet selbst zu)
    icons/apple-touch-icon.png   180 x 180 randlos, ohne Transparenz (das iPad rundet die Ecken selbst ab)

Motiv: dunkler Hintergrund mit drei „Textzeilen“ aus Wort-Balken. Der vordere Teil ist grün – so wie
Mitleser beim Vorlesen die schon gelesenen Wörter einfärbt.
Benötigt Pillow (ist in Anaconda enthalten).
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "icons"

SUPERSAMPLE = 4  # in vierfacher Größe zeichnen und danach verkleinern -> glatte Kanten
RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS

BG_TOP = (30, 38, 48)  # Hintergrund oben (dunkles Blaugrau)
BG_BOTTOM = (10, 13, 18)  # Hintergrund unten (fast schwarz)
READ = (111, 211, 155)  # schon gelesen (grün)
UNREAD = (232, 236, 241)  # noch nicht gelesen (hell)

BAR_HEIGHT = 0.085  # Höhe eines Wort-Balkens (Anteil der Bildgröße)

# Je Zeile: senkrechte Mitte und Wörter als (links, rechts, Farbe) – alles in Anteilen der Bildgröße (0 … 1).
# Zeile 1 ist ganz gelesen, Zeile 2 zur Hälfte, Zeile 3 noch gar nicht.
LINES = [
    (0.33, [(0.20, 0.47, READ), (0.53, 0.80, READ)]),
    (0.50, [(0.20, 0.42, READ), (0.48, 0.80, UNREAD)]),
    (0.67, [(0.20, 0.36, UNREAD), (0.42, 0.66, UNREAD)]),
]


def gradient(size):
    """Quadratisches Bild mit senkrechtem Farbverlauf."""
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def draw_lines(img, scale):
    """Zeichnet die drei Zeilen. scale < 1 rückt das Motiv zur Bildmitte (für die sichere Zone)."""
    size = img.size[0]
    draw = ImageDraw.Draw(img)

    def px(value):
        return (0.5 + (value - 0.5) * scale) * size

    height = BAR_HEIGHT * scale * size
    for center, words in LINES:
        cy = px(center)
        for left, right, color in words:
            box = [px(left), cy - height / 2, px(right), cy + height / 2]
            draw.rounded_rectangle(box, radius=height / 2, fill=color)


def make_icon(size, *, rounded, scale, opaque):
    big = size * SUPERSAMPLE
    img = gradient(big).convert("RGBA")
    draw_lines(img, scale)
    if rounded:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.22), fill=255)
        img.putalpha(mask)
    img = img.resize((size, size), RESAMPLE)
    return img.convert("RGB") if opaque else img


ICONS = [
    ("icon-192.png", dict(size=192, rounded=True, scale=1.0, opaque=False)),
    ("icon-512.png", dict(size=512, rounded=True, scale=1.0, opaque=False)),
    # Sichere Zone: Kreis mit 40 % Radius um die Mitte -> Motiv auf 80 % verkleinern.
    ("icon-maskable-512.png", dict(size=512, rounded=False, scale=0.8, opaque=True)),
    ("apple-touch-icon.png", dict(size=180, rounded=False, scale=0.94, opaque=True)),
]


def main():
    OUT_DIR.mkdir(exist_ok=True)
    for name, options in ICONS:
        path = OUT_DIR / name
        make_icon(**options).save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {options['size']}x{options['size']}  {path.stat().st_size} Bytes")


if __name__ == "__main__":
    main()
