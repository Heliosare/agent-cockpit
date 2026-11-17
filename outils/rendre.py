#!/usr/bin/env python3
"""Rendu simulé du panneau : l'arbre que le mod dessine -> une page HTML qui imite l'app de bureau.

Calé sur des captures réelles de l'app (thème sombre, 17/11) : une case = 8,85 px de large et 20 px de haut,
texte courant 13,5 px, bouton « plain » = texte avec 8 px de marge, bouton normal = pastille de 28 px.
Ce qui n'a pas été vu dans l'app (pas « xs », taille « caption », bordures) est une supposition.
"""
import html
import json
import sys

C, R = 8.85, 20.0
# « sm » mesuré dans l'app : 12 px. Les autres pas sont supposés.
PAS = {"xs": 8, "sm": 12, "md": 16, "lg": 20, "xl": 24}
THEME = {
    "text": "#ECEAE4", "inverseText": "#1F1E1C", "inactive": "#8F8D88", "subtle": "#6F6D69",
    "success": "#5DBB6D", "error": "#E8695B", "warning": "#D9A441", "suggestion": "#7C8CF8",
    "merged": "#B28CF2", "claude": "#D97757",
}
DIM = "#9A9893"
LIEN = "#6FA6F6"


def couleur(c):
    return THEME.get(c, c)


def esp(v, vertical=False):
    if v is None:
        return None
    if isinstance(v, str):
        return f"{PAS[v]}px" if v in PAS else v
    return f"{v * (R if vertical else C):.1f}px"


def style_box(p, parent_dir):
    d = p.get("flexDirection", "row")
    s = ["display:flex", f"flex-direction:{d}", "box-sizing:border-box", "min-width:0"]
    if p.get("display") == "none":
        s[0] = "display:none"
    for k, css in (("alignItems", "align-items"), ("justifyContent", "justify-content"), ("flexWrap", "flex-wrap"),
                   ("flexGrow", "flex-grow"), ("flexShrink", "flex-shrink"), ("overflow", "overflow")):
        if k in p and p[k] is not None:
            s.append(f"{css}:{p[k]}")
    col = d.startswith("column")
    if "gap" in p:
        g = p["gap"]
        if isinstance(g, str):
            s.append(f"gap:{esp(g)}")
        else:
            s.append(f"row-gap:{esp(g, True)}")
            s.append(f"column-gap:{esp(g)}")
    if "rowGap" in p:
        s.append(f"row-gap:{esp(p['rowGap'], True)}")
    if "columnGap" in p:
        s.append(f"column-gap:{esp(p['columnGap'])}")
    if p.get("width") is not None:
        s.append(f"width:{esp(p['width'])}")
        s.append("flex-basis:auto")
    if p.get("height") is not None:
        s.append(f"height:{esp(p['height'], True)}")
    for k, css, vert in (("marginTop", "margin-top", True), ("marginBottom", "margin-bottom", True),
                         ("marginLeft", "margin-left", False), ("marginRight", "margin-right", False),
                         ("paddingLeft", "padding-left", False), ("paddingRight", "padding-right", False),
                         ("paddingTop", "padding-top", True), ("paddingBottom", "padding-bottom", True)):
        if p.get(k) is not None:
            s.append(f"{css}:{esp(p[k], vert)}")
    if p.get("paddingX") is not None:
        s.append(f"padding-left:{esp(p['paddingX'])};padding-right:{esp(p['paddingX'])}")
    if p.get("paddingY") is not None:
        s.append(f"padding-top:{esp(p['paddingY'], True)};padding-bottom:{esp(p['paddingY'], True)}")
    if p.get("backgroundColor"):
        s.append(f"background:{couleur(p['backgroundColor'])}")
    if p.get("borderStyle"):
        bc = couleur(p.get("borderColor", "#55534F"))
        s.append(f"border:1px solid {bc};border-radius:{'9px' if p['borderStyle'] == 'round' else '2px'}")
        # vu dans l'app : sans marge demandée, une boîte bordée garde ~16 px de chaque côté
        if p.get("paddingX") is None and p.get("paddingLeft") is None:
            s.append("padding-left:16px;padding-right:16px")
    if p.get("position") == "absolute":
        s.append("position:absolute;z-index:5")
        for k, vert in (("top", True), ("bottom", True), ("left", False), ("right", False)):
            if p.get(k) is not None:
                s.append(f"{k}:{esp(p[k], vert)}")
    else:
        s.append("position:relative")
    return ";".join(s)


def style_text(p):
    s = []
    size = {"caption": 11.6, "footnote": 12.5, "body": 13.3, "heading": 15, "title": 19.5}.get(p.get("size"))
    if p.get("mono"):
        s.append('font-family:"SF Mono",Menlo,monospace;font-size:13.8px')
    elif size:
        s.append(f"font-size:{size}px")
    w = p.get("weight") or ("semibold" if p.get("bold") else None)
    if w:
        s.append(f"font-weight:{ {'regular': 400, 'medium': 500, 'semibold': 600, 'bold': 700}[w] }")
    if p.get("color"):
        s.append(f"color:{couleur(p['color'])}")
    elif p.get("dimColor"):
        s.append(f"color:{DIM}")
    if p.get("backgroundColor"):
        s.append(f"background:{couleur(p['backgroundColor'])}")
    if p.get("tabular"):
        s.append("font-variant-numeric:tabular-nums")
    if p.get("italic"):
        s.append("font-style:italic")
    if p.get("wrap", "wrap").startswith("truncate"):
        s.append("white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;min-width:0")
    return ";".join(s)


def rendre(n, parent_dir="column", dans_texte=False):
    if isinstance(n, str):
        return html.escape(n)
    t, p = n["type"], n.get("props", {})
    enfants = "".join(rendre(c, p.get("flexDirection", "row"), t in ("Text", "Link") or dans_texte) for c in n.get("children", []))
    if t == "Box":
        return f'<div style="{style_box(p, parent_dir)}">{enfants}</div>'
    if t == "Text":
        tag = "span"
        st = style_text(p)
        if not dans_texte:
            st += ";line-height:20px"
        return f'<{tag} style="{st}">{enfants}</{tag}>'
    if t == "Link":
        return f'<a style="color:{LIEN};text-decoration:none;line-height:20px">{enfants or html.escape(p.get("label", ""))}</a>'
    if t == "Button":
        lab = html.escape(p.get("label") or "") or enfants
        if p.get("plain"):
            col = DIM if p.get("dimColor") else THEME["text"]
            return f'<span style="padding:0 8px;line-height:20px;white-space:nowrap;color:{col};flex-shrink:0">{lab}</span>'
        prim = p.get("variant") == "primary"
        bg, fg = ("#ECEAE4", "#1F1E1C") if prim else ("#3A3937", DIM if p.get("dimColor") else THEME["text"])
        return (f'<span style="display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:8px;'
                f'background:{bg};color:{fg};font-size:14.5px;white-space:nowrap;flex-shrink:0">{lab}</span>')
    return enfants


def page(tree, colonnes, titre="Tableau de bord"):
    large = colonnes * C
    corps = rendre(tree)
    return f'''<div style="width:{large + 44:.0f}px;background:#1F1E1D;color:{THEME['text']};font-family:Inter,system-ui,sans-serif;font-size:13.3px">
<div style="display:flex;align-items:center;height:44px;padding:0 22px;border-bottom:1px solid #343331;font-size:14.5px">
<span style="flex:1">{html.escape(titre)}</span><span style="color:{DIM};letter-spacing:14px">⤢✕</span></div>
<div style="padding:22px 22px 26px;width:{large:.0f}px">{corps}</div></div>'''


if __name__ == "__main__":
    tree = json.load(open(sys.argv[1]))
    print(page(tree, int(sys.argv[2])))
