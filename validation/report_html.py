# -*- coding: utf-8 -*-
"""Turn VALIDATION_REPORT.md into a self-contained HTML file (images embedded) that opens with a
double-click. Handles only what the report uses: headings, paragraphs, bullet lists, tables, bold,
inline code and images."""
import base64
import html
import io
import os
import re

CSS = ('body{font:14px/1.55 "Segoe UI",Arial,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;color:#1f2937}'
       'h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}'
       '.t{overflow-x:auto}table{border-collapse:collapse;font-size:12px;margin:8px 0}'
       'th,td{border:1px solid #d1d5db;padding:4px 7px;text-align:left;vertical-align:top}th{background:#f3f4f6}'
       'img{max-width:100%}code{background:#f3f4f6;padding:0 4px;border-radius:3px}')


def _inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    return re.sub(r'`(.+?)`', r'<code>\1</code>', t)


def write_html(md_path, html_path):
    base = os.path.dirname(md_path)
    lines = io.open(md_path, encoding='utf-8').read().split('\n')
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r'!\[(.*?)\]\((.+?)\)', line)
        if m:
            with open(os.path.join(base, m.group(2)), 'rb') as f:
                data = base64.b64encode(f.read()).decode()
            out.append(f'<p><img alt="{html.escape(m.group(1))}" src="data:image/png;base64,{data}"></p>')
            i += 1
            continue
        if line.startswith('#'):
            n = len(line) - len(line.lstrip('#'))
            out.append(f'<h{n}>{_inline(line[n:].strip())}</h{n}>')
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            head = rows[0]
            body = [r for r in rows[1:] if not all(set(c) <= set('-: ') for c in r)]
            out.append('<div class="t"><table><tr>' + ''.join(f'<th>{_inline(c)}</th>' for c in head) + '</tr>'
                       + ''.join('<tr>' + ''.join(f'<td>{_inline(c)}</td>' for c in r) + '</tr>' for r in body)
                       + '</table></div>')
            continue
        if line.startswith('- '):
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(_inline(lines[i][2:]))
                i += 1
            out.append('<ul>' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>')
            continue
        if line.strip():
            out.append(f'<p>{_inline(line)}</p>')
        i += 1
    io.open(html_path, 'w', encoding='utf-8').write(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SC model validation</title>'
        f'<style>{CSS}</style></head><body>' + '\n'.join(out) + '</body></html>\n')
