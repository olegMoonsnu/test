"""Build the embedded application from the same HTML used in the offline demo."""
import argparse
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--class-fqn", default="serviceCall", help="NSD request class or type FQN")
args = parser.parse_args()
if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]*(?:\$[a-zA-Z][a-zA-Z0-9_]*)?", args.class_fqn):
    parser.error("Expected a class code or class$type")

html = (ROOT / "demo/smp-portal.html").read_text(encoding="utf-8")
files = {}
for tag, name, loader in [
    ("style", "portal.css", '<link rel="stylesheet" href="portal.css">'),
    ("script", "portal.js", '<script src="portal.js"></script>'),
]:
    start, end = "<" + tag + ">", "</" + tag + ">"
    if html.count(start) != 1 or html.count(end) != 1:
        raise ValueError(f"Expected one inline {tag} in the standalone demo")
    before, content = html.split(start)
    asset, after = content.split(end)
    files[name] = asset
    html = before + loader + after

html = html.replace("'unsafe-inline'", "'self'")
banner = (
    '<section class="nsd-form" aria-label="Подключение к NSD">'
    f'<button type="button" class="secondary" id="openNsdForm" data-class-fqn="{args.class_fqn}" disabled>'
    'Создать запрос в NSD</button> '
    '<span id="nsdConnection" role="status">Проверка подключения к NSD…</span></section>'
)
html = html.replace('</header>', '</header>' + banner)
html = html.replace('</html>', '<script src="nsd.js"></script></html>')
files["index.html"] = html
files["portal.css"] += '\n.nsd-form{max-width:1180px;margin:14px auto;padding:0 18px}.nsd-form span{font-size:14px}.nsd-form button:disabled{cursor:default;opacity:.65}\n'
files["nsd.js"] = (ROOT / "src/portal/nsd.js").read_text(encoding="utf-8")

target = ROOT / "dist/smp-portal-demo.zip"
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w") as archive:
    for name in sorted(files):
        entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, files[name].encode("utf-8"), compress_type=ZIP_DEFLATED)
print(target)
