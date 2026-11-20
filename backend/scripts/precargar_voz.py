"""Descarga la voz de Piper durante `docker build` (como Whisper): la demo no espera descargas.

Si no hay internet o la descarga falla, NO rompe la construcción: la app arranca igual y el
navegador lee la explicación con su propia voz.
"""
import os
import sys
import urllib.request

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"


def main(voz: str, destino: str) -> None:
    region, nombre, calidad = voz.split("-")  # p. ej. es_MX-claude-high -> es_MX, claude, high
    familia = region.split("_")[0]           # es
    os.makedirs(destino, exist_ok=True)
    for extension in (".onnx", ".onnx.json"):
        url = f"{BASE}/{familia}/{region}/{nombre}/{calidad}/{voz}{extension}"
        ruta = os.path.join(destino, voz + extension)
        print(f"Descargando {url}")
        urllib.request.urlretrieve(url, ruta)
    print(f"Voz {voz} lista en {destino}")


if __name__ == "__main__":
    voz = sys.argv[1] if len(sys.argv) > 1 else "es_MX-claude-high"
    destino = sys.argv[2] if len(sys.argv) > 2 else "/modelos/voz"
    try:
        main(voz, destino)
    except Exception as e:  # noqa: BLE001
        print(f"AVISO: no se pudo descargar la voz {voz} ({e}). Se usará la voz del navegador.")
