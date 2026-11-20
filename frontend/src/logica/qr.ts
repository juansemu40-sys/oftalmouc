// Generador de códigos QR (ISO/IEC 18004), modo byte, corrección de errores M (~15 %), versiones 1 a 10.
// Propio y sin dependencias: el enlace del paciente nunca pasa por un servicio externo para dibujar el QR.
// Basado en el algoritmo de referencia de Project Nayuki (QR Code generator library, licencia MIT).

/** Código QR como matriz: true = módulo oscuro. matriz[y][x]. */
export interface CodigoQR {
  version: number;
  tamano: number;
  matriz: boolean[][];
}

// Tablas para corrección M, índice = versión (0 sin uso).
const ECC_POR_BLOQUE = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOQUES = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const VERSION_MAXIMA = 10;
const FORMATO_M = 0; // bits de nivel de corrección para M

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function modulosDeDatos(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const palabrasDeDatos = (ver: number) => Math.floor(modulosDeDatos(ver) / 8) - ECC_POR_BLOQUE[ver] * BLOQUES[ver];

// ---- Reed-Solomon sobre GF(2^8), polinomio 0x11D
function multiplicar(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(grado: number): number[] {
  const r: number[] = new Array(grado - 1).fill(0);
  r.push(1);
  let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicar(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return r;
}

function residuo(datos: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of datos) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= multiplicar(c, factor); });
  }
  return r;
}

function utf8(texto: string): number[] {
  return Array.from(new TextEncoder().encode(texto));
}

/** Arma el QR del texto. Lanza error si no cabe en la versión 10 (≈ 213 bytes): un enlace cabe sobrado. */
export function generarQR(texto: string): CodigoQR {
  const bytes = utf8(texto);
  let ver = 1;
  for (; ver <= VERSION_MAXIMA; ver++) {
    const bitsConteo = ver < 10 ? 8 : 16;
    if (4 + bitsConteo + bytes.length * 8 <= palabrasDeDatos(ver) * 8) break;
  }
  if (ver > VERSION_MAXIMA) throw new Error("Texto demasiado largo para el código QR.");

  // ---- 1. bits de datos: modo byte (0100) + conteo + bytes + terminador + relleno
  const bits: number[] = [];
  const poner = (valor: number, largo: number) => { for (let i = largo - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  poner(0b0100, 4);
  poner(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach((b) => poner(b, 8));
  const capacidad = palabrasDeDatos(ver) * 8;
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let relleno = 0xec; bits.length < capacidad; relleno ^= 0xec ^ 0x11) poner(relleno, 8);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // ---- 2. corrección de errores por bloques y entrelazado
  const nBloques = BLOQUES[ver];
  const largoEcc = ECC_POR_BLOQUE[ver];
  const totales = Math.floor(modulosDeDatos(ver) / 8);
  const cortos = nBloques - (totales % nBloques);
  const largoCorto = Math.floor(totales / nBloques);
  const div = divisor(largoEcc);
  const bloques: number[][] = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const dat = datos.slice(k, k + largoCorto - largoEcc + (i < cortos ? 0 : 1));
    k += dat.length;
    const ecc = residuo(dat, div);
    if (i < cortos) dat.push(0);
    bloques.push(dat.concat(ecc));
  }
  const palabras: number[] = [];
  for (let i = 0; i < bloques[0].length; i++) {
    bloques.forEach((b, j) => { if (i !== largoCorto - largoEcc || j >= cortos) palabras.push(b[i]); });
  }

  // ---- 3. patrones fijos
  const tamano = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: tamano }, () => new Array(tamano).fill(false));
  const fijo: boolean[][] = Array.from({ length: tamano }, () => new Array(tamano).fill(false));
  const fijar = (x: number, y: number, oscuro: boolean) => { m[y][x] = oscuro; fijo[y][x] = true; };

  for (let i = 0; i < tamano; i++) { fijar(6, i, i % 2 === 0); fijar(i, 6, i % 2 === 0); }
  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && x < tamano && y >= 0 && y < tamano) fijar(x, y, d !== 2 && d !== 4);
    }
  };
  buscador(3, 3); buscador(tamano - 4, 3); buscador(3, tamano - 4);

  const alineacion: number[] = [];
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2;
    const paso = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    alineacion.push(6);
    for (let pos = tamano - 7; alineacion.length < n; pos -= paso) alineacion.splice(1, 0, pos);
  }
  const ultimo = alineacion.length - 1;
  alineacion.forEach((ax, i) => alineacion.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fijar(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const dibujarFormato = (mascara: number) => {
    const datosF = (FORMATO_M << 3) | mascara;
    let r = datosF;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((datosF << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) fijar(8, i, bit(b, i));
    fijar(8, 7, bit(b, 6)); fijar(8, 8, bit(b, 7)); fijar(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) fijar(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) fijar(tamano - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) fijar(8, tamano - 15 + i, bit(b, i));
    fijar(8, tamano - 8, true); // módulo oscuro
  };
  dibujarFormato(0); // reserva el área

  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = tamano - 11 + (i % 3), c = Math.floor(i / 3);
      fijar(a, c, bit(b, i)); fijar(c, a, bit(b, i));
    }
  }

  // ---- 4. datos en zigzag
  let i = 0;
  for (let derecha = tamano - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let v = 0; v < tamano; v++) for (let j = 0; j < 2; j++) {
      const x = derecha - j;
      const y = ((derecha + 1) & 2) === 0 ? tamano - 1 - v : v;
      if (!fijo[y][x] && i < palabras.length * 8) {
        m[y][x] = bit(palabras[i >>> 3], 7 - (i & 7));
        i++;
      }
    }
  }

  // ---- 5. máscara con menor penalización
  const invertir = (mascara: number) => {
    for (let y = 0; y < tamano; y++) for (let x = 0; x < tamano; x++) {
      if (fijo[y][x]) continue;
      let c: boolean;
      switch (mascara) {
        case 0: c = (x + y) % 2 === 0; break;
        case 1: c = y % 2 === 0; break;
        case 2: c = x % 3 === 0; break;
        case 3: c = (x + y) % 3 === 0; break;
        case 4: c = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: c = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: c = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: c = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (c) m[y][x] = !m[y][x];
    }
  };
  let mejor = 0, menor = Infinity;
  for (let k = 0; k < 8; k++) {
    invertir(k);
    dibujarFormato(k);
    const p = penalizacion(m);
    if (p < menor) { menor = p; mejor = k; }
    invertir(k);
  }
  invertir(mejor);
  dibujarFormato(mejor);
  return { version: ver, tamano, matriz: m };
}

/** Reglas de penalización de la norma: tramos largos, bloques 2x2, patrones parecidos al buscador y balance. */
function penalizacion(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const lineas = (obtener: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let largo = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && obtener(a, b) === obtener(a, b - 1)) { largo++; continue; }
        if (largo >= 5) p += largo - 2;
        largo = 1;
      }
      // patrón 1:1:3:1:1 con 4 claros a un lado
      for (let b = 0; b + 10 < n; b++) {
        const s = Array.from({ length: 11 }, (_, k) => obtener(a, b + k));
        const patron = [true, false, true, true, true, false, true];
        const claro = (desde: number) => s.slice(desde, desde + 4).every((v) => !v);
        if (patron.every((v, k) => s[k] === v) && claro(7)) p += 40;
        if (patron.every((v, k) => s[k + 4] === v) && claro(0)) p += 40;
      }
    }
  };
  lineas((y, x) => m[y][x]);
  lineas((x, y) => m[y][x]);
  let oscuros = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) oscuros++;
    if (x < n - 1 && y < n - 1) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  }
  const total = n * n;
  p += (Math.ceil(Math.abs(oscuros * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** Trazo SVG del QR (un rectángulo por módulo oscuro), desplazado por el margen silencioso. */
export function rutaSVG(qr: CodigoQR, margen = 4): string {
  const partes: string[] = [];
  qr.matriz.forEach((fila, y) => fila.forEach((oscuro, x) => {
    if (oscuro) partes.push(`M${x + margen},${y + margen}h1v1h-1z`);
  }));
  return partes.join("");
}
