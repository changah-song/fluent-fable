#!/usr/bin/env python3
"""Build ko_dict.db from the KRDICT 한국어기초사전 (Korean Basic Dictionary) export.

The bundled snapshot lets the backend resolve Korean lookups offline, the same
way en_dict.db / zh_dict.db do for English and Chinese, instead of hitting the
live KRDICT API for every word. See get_ko_dict_db_connection /
lookup_ko_dictionary_entries in main.py for the read side.

Source
------
Download the 한국어기초사전 export from https://krdict.korean.go.kr (the "사전 전체
내려받기" popup: https://krdict.korean.go.kr/download/downloadPopup) — the learner
dictionary, NOT 우리말샘/표준국어대사전, which are far larger. It ships under
CC BY-SA 2.0 KR, the same license family as the Wiktionary data already in
en_dict.db, so attribution + share-alike carry over unchanged.

The official download is a ZIP of underscore-named XML parts; unzip it and point
--src at the directory. A ready-made mirror of the same files also lives at
github.com/spellcheck-ko/korean-dict-nikl-krdict (5000.xml … 51947.xml).

Format
------
The dump is **LMF** (Lexical Markup Framework), the DTD referenced at the top of
each file (DTD_LMF_REV_16.dtd). Everything is `<feat att="…" val="…"/>` pairs:

    <LexicalEntry att="id" val="27733">
      <feat att="partOfSpeech" val="명사" />
      <feat att="origin" val="哥" />              <!-- hanja, when present -->
      <feat att="subjectCategory" val="…" />       <!-- domain, when present -->
      <Lemma><feat att="writtenForm" val="가" /></Lemma>
      <Sense att="id" val="1">
        <feat att="definition" val="… Korean monolingual def …" />
        <Equivalent>
          <feat att="language" val="영어" />
          <feat att="lemma" val="edge; verge" />   <!-- English gloss we keep -->
          <feat att="definition" val="The perimeter …" />
        </Equivalent>
        <Equivalent><feat att="language" val="일본어" />…</Equivalent>
      </Sense>
    </LexicalEntry>

Homonyms are repeated LexicalEntry elements sharing one writtenForm, so sense_no
is assigned as a running counter per headword across all its entries (primary
sense = 1). This is verified against real dump data, not guessed.

Scope
-----
English glosses only (the Equivalent block whose language == 영어). The live KO
path already runs English-only (DEFAULT_INTERFACE_LANGUAGE == "en",
lookup_stem_in_krdict passes trans_lang="1"), so an English snapshot is a faithful
match and keeps the file small. To add the other languages later, keep every
Equivalent and add an `interface_language` column keyed on its language val.

Usage
-----
    python scripts/import_ko_dict.py --src ./krdict_xml --out ko_dict.db
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sqlite3
import xml.etree.ElementTree as ET

# The Equivalent block whose language feat holds this value is the English one.
ENGLISH_TRANS_LANG = "영어"

# XML 1.0 forbids the C0 control chars (everything below 0x20 except tab/LF/CR).
# Some KRDICT files embed a stray \x08 backspace inside non-English (e.g. Arabic)
# definitions, which makes expat reject the whole file. Strip them before parsing;
# they never touch the English glosses we keep, so no data we care about is lost.
INVALID_XML_CHARS = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")

# KRDICT's own data misspells the domain attribute in some rows; accept both.
DOMAIN_ATTS = ("subjectCategory", "subjectCategiory")

SCHEMA = """
DROP TABLE IF EXISTS ko_dictionary;
CREATE TABLE ko_dictionary (
    stem       TEXT NOT NULL,      -- dictionary headword: 공부하다, 사과
    sense_no   INTEGER DEFAULT 1,  -- 1 = primary/most popular sense
    pos        TEXT,               -- 품사 (동사, 명사, …)
    hanja      TEXT,               -- 원어 / origin (工夫), nullable
    definition TEXT,               -- English trans_word gloss
    domain     TEXT,               -- 전문 분야 / semantic category, nullable
    PRIMARY KEY (stem, sense_no)
);
"""


def feat(node: ET.Element | None, att: str) -> str | None:
    """Value of the direct-child <feat att=... val=.../> with this att, or None."""
    if node is None:
        return None
    for child in node.findall("feat"):
        if child.get("att") == att:
            val = (child.get("val") or "").strip()
            return val or None
    return None


def feat_any(node: ET.Element | None, atts: tuple[str, ...]) -> str | None:
    for att in atts:
        val = feat(node, att)
        if val is not None:
            return val
    return None


def english_gloss(sense: ET.Element) -> str | None:
    """The English Equivalent's lemma (e.g. 'edge; verge'), matching the live
    path's trans_word. None if this sense has no English equivalent."""
    for equivalent in sense.findall("Equivalent"):
        if feat(equivalent, "language") == ENGLISH_TRANS_LANG:
            return feat(equivalent, "lemma")
    return None


def iter_entries(xml_path: str, sense_counter: dict[str, int]):
    """Yield (stem, sense_no, pos, hanja, definition, domain) rows from one LMF
    file. One row per sense that has an English equivalent; senses without one
    are skipped. `sense_counter` is shared across files so homonyms (repeated
    LexicalEntry with the same writtenForm) get a stable running sense_no and
    never collide on the (stem, sense_no) primary key.
    """
    text = INVALID_XML_CHARS.sub("", open(xml_path, encoding="utf-8").read())
    root = ET.fromstring(text)
    for entry in root.iter("LexicalEntry"):
        lemma = entry.find("Lemma")
        stem = feat(lemma, "writtenForm")
        if not stem:
            continue

        pos = feat(entry, "partOfSpeech")
        hanja = feat(entry, "origin")
        domain = feat_any(entry, DOMAIN_ATTS)

        for sense in entry.findall("Sense"):
            gloss = english_gloss(sense)
            if not gloss:
                continue
            sense_no = sense_counter.get(stem, 0) + 1
            sense_counter[stem] = sense_no
            yield (stem, sense_no, pos, hanja, gloss, domain)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ko_dict.db from KRDICT XML.")
    parser.add_argument("--src", required=True, help="directory of KRDICT .xml files")
    parser.add_argument("--out", default="ko_dict.db", help="output SQLite path")
    args = parser.parse_args()

    def numeric_key(path: str) -> tuple[int, str]:
        # Files are named by entry count (5000.xml … 51947.xml); sort numerically
        # so senses arrive in dump order and sense_no=1 is the first/most-common
        # sense even when a headword's homonyms span a file boundary.
        name = os.path.splitext(os.path.basename(path))[0]
        return (int(name), name) if name.isdigit() else (10**9, name)

    xml_files = sorted(glob.glob(os.path.join(args.src, "*.xml")), key=numeric_key)
    if not xml_files:
        raise SystemExit(f"No .xml files found under {args.src!r}")

    conn = sqlite3.connect(args.out)
    try:
        conn.executescript(SCHEMA)
        total = 0
        skipped = []
        sense_counter: dict[str, int] = {}
        for xml_path in xml_files:
            try:
                rows = list(iter_entries(xml_path, sense_counter))
            except ET.ParseError as error:
                # One unparseable file shouldn't sink a 50-file import — warn,
                # skip, keep going, and report the casualties at the end.
                print(f"[import] SKIP {os.path.basename(xml_path)}: {error}")
                skipped.append(os.path.basename(xml_path))
                continue
            conn.executemany(
                "INSERT OR IGNORE INTO ko_dictionary "
                "(stem, sense_no, pos, hanja, definition, domain) VALUES (?,?,?,?,?,?)",
                rows,
            )
            conn.commit()
            total += len(rows)
            print(f"[import] {os.path.basename(xml_path)}: +{len(rows)} rows (total {total})")

        conn.execute("CREATE INDEX idx_ko_dictionary_stem ON ko_dictionary(stem)")
        conn.commit()

        headwords = conn.execute(
            "SELECT COUNT(DISTINCT stem) FROM ko_dictionary"
        ).fetchone()[0]
        print(f"[import] done — {total} sense rows across {headwords} headwords → {args.out}")
        if skipped:
            print(f"[import] WARNING: skipped {len(skipped)} unparseable file(s): {', '.join(skipped)}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
