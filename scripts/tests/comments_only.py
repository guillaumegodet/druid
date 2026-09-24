#!/usr/bin/env python3
# Translation campaign helper (docs/archive/plan-traduction-commentaires.md): when a file in the
# working tree mixes translated comments with unrelated code changes made by someone else,
# build a copy that keeps the HEAD code and takes only the comment changes, so the comment
# translation can be committed alone (stage it with git hash-object + update-index).
# Usage: python3 scripts/tests/comments_only.py <path> <out>
"""Build <out> = HEAD version of a file + comment-only changes taken from the working copy.
Lines whose code part differs (or inserted/deleted lines) keep the HEAD version."""
import sys, difflib, re, subprocess
path, out = sys.argv[1], sys.argv[2]
head = subprocess.check_output(['git', 'show', f'HEAD:{path}'], text=True).split('\n')
work = open(path, encoding='utf-8').read().split('\n')

def code_part(line):
    """Line without its trailing // comment and without /* */ segments (string-aware for //)."""
    quote = None; i = 0; s = line
    while i < len(s):
        ch = s[i]
        if quote:
            if ch == '\\': i += 2; continue
            if ch == quote: quote = None
        elif ch in '"\'`': quote = ch
        elif ch == '/' and s[i+1:i+2] == '/' and s[i-1:i] not in (':', '\\'):
            s = s[:i]; break
        elif ch == '/' and s[i+1:i+2] == '*':
            end = s.find('*/', i + 2)
            s = s[:i] + (s[end+2:] if end != -1 else ''); continue
        i += 1
    return s.rstrip()

def is_comment_line(line):
    t = line.strip()
    return t.startswith('//') or t.startswith('*') or t.startswith('/*')

res = []; kept_code = 0; taken = 0
hk = [code_part(l) if not is_comment_line(l) else '' for l in head]
wk = [code_part(l) if not is_comment_line(l) else '' for l in work]
sm = difflib.SequenceMatcher(None, hk, wk, autojunk=False)
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        for h, w in zip(head[i1:i2], work[j1:j2]):
            ok = (is_comment_line(h) and is_comment_line(w)) or code_part(h) == code_part(w)
            res.append(w if ok else h); taken += ok; kept_code += (not ok)
        continue
    if tag == 'replace' and (i2 - i1) == (j1 - j2) * -1 + 0 and (i2 - i1) == (j2 - j1):
        for h, w in zip(head[i1:i2], work[j1:j2]):
            same_code = (is_comment_line(h) and is_comment_line(w)) or code_part(h) == code_part(w)
            if same_code: res.append(w); taken += 1
            else: res.append(h); kept_code += 1
    else:
        res.extend(head[i1:i2]); kept_code += (i2 - i1) + (j2 - j1)
open(out, 'w', encoding='utf-8').write('\n'.join(res))
print(f'{path}: lines HEAD={len(head)} out={len(res)} work={len(work)}; comment lines taken={taken}, code lines kept from HEAD={kept_code}')
