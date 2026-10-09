# -*- coding: utf-8 -*-
"""Produce the @font-face block that gets inlined into the single-file app.

Inter carries the interface and the numbers; Geist is the display face for the title, the
section headings and the logo wordmark. Google Fonts' latin woff2 is fetched, subset with
fontTools to the characters this app can actually draw, and written back as woff2 - the subset
is roughly a fifth of the full face, which is what makes embedding affordable."""
import re, io, os, base64, urllib.request
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'app', 'keytruda_simulator.html')
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fonts.css')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/125.0 Safari/537.36'}
FAMILIES = [('Inter', [400, 600, 700]), ('Geist', [500, 600, 700])]

# Every character the built app can put on screen. Hangul is left to the system font - the
# interface is English and embedding Korean would cost megabytes.
text = io.open(APP, encoding='utf-8').read()
keep = {c for c in text if 0x20 <= ord(c) <= 0x2BFF
        and not (0xAC00 <= ord(c) <= 0xD7A3 or 0x3130 <= ord(c) <= 0x318F)}
keep |= set('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
subset_text = ''.join(sorted(keep))
print('characters kept:', len(keep))


def fetch(url, headers=UA):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=90).read()


faces, total = [], 0
for fam, weights in FAMILIES:
    q = fam.replace(' ', '+') + ':wght@' + ';'.join(str(w) for w in weights)
    css = fetch('https://fonts.googleapis.com/css2?family=%s&display=swap' % q).decode()
    # the latin block of each weight, in the order the weights were requested
    blocks = re.findall(r'/\* latin \*/\s*@font-face\s*\{(.*?)\}', css, re.S)
    got = {}
    for b in blocks:
        w = int(re.search(r'font-weight:\s*(\d+)', b).group(1))
        got[w] = re.search(r'url\((https://[^)]+\.woff2)\)', b).group(1)
    for w in weights:
        assert w in got, (fam, w, sorted(got))
        raw = fetch(got[w])
        f = TTFont(io.BytesIO(raw))
        opt = Options()
        opt.layout_features = ['kern', 'liga', 'calt', 'tnum', 'ccmp']
        opt.drop_tables += ['DSIG']
        opt.notdef_outline = True
        s = Subsetter(options=opt)
        s.populate(text=subset_text)
        s.subset(f)
        f.flavor = 'woff2'
        buf = io.BytesIO(); f.save(buf)
        data = buf.getvalue(); total += len(data)
        faces.append("@font-face{font-family:'%s';font-style:normal;font-weight:%d;font-display:swap;"
                     "src:url(data:font/woff2;base64,%s) format('woff2')}"
                     % (fam, w, base64.b64encode(data).decode()))
        print('%-6s %3d   full %6.1f KB -> subset %5.1f KB' % (fam, w, len(raw)/1024, len(data)/1024))

io.open(OUT, 'w', encoding='utf-8').write('\n'.join(faces) + '\n')
print('\nwrote %s  (%.0f KB inline CSS, %.0f KB of font data)' % (OUT, os.path.getsize(OUT)/1024, total/1024))
