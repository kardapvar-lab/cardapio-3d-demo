"""Carimba uma versão nova no site antes de publicar.

Atualiza o número em index.html (const VERSAO) e grava versao.json com o mesmo valor.
Quem estiver com a página antiga aberta recarrega sozinho na versão nova.

Uso (na raiz do repositório):  python3 ferramentas/versao.py
"""
import datetime
import json
import pathlib
import re

raiz = pathlib.Path(__file__).resolve().parent.parent
versao = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

index = raiz / "index.html"
html = index.read_text(encoding="utf-8")
novo, trocas = re.subn(r"const VERSAO = '[^']*';", f"const VERSAO = '{versao}';", html, count=1)
if trocas != 1:
    raise SystemExit("Não achei 'const VERSAO' no index.html")
index.write_text(novo, encoding="utf-8")

(raiz / "versao.json").write_text(json.dumps({"versao": versao}) + "\n", encoding="utf-8")
print("versão", versao)
