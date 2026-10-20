// Reconhecimento de texto (OCR) de capturas de tela de itens, no próprio navegador (tesseract.js).
// Na primeira utilização o tesseract.js baixa o motor e o modelo de inglês (~10 MB) de cdn.jsdelivr.net;
// depois fica no cache do navegador. A imagem nunca é enviada a servidores.
import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number, status: string) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, {
        logger: (m: { progress: number; status: string }) => progressCb?.(m.progress, m.status),
      }),
    );
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

function loadImage(src: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = URL.createObjectURL(src);
  });
}

/**
 * Prepara a imagem para OCR: amplia (texto pequeno), converte para tons de cinza e inverte quando o
 * fundo é escuro (tooltips do jogo têm texto claro sobre fundo escuro), aumentando o contraste.
 */
export async function preprocess(src: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const scale = img.width < 1400 ? Math.min(3, 1400 / img.width) : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const dark = sum / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    // Usa o canal mais claro para preservar texto colorido (azul dos mods, dourado dos nomes).
    let v = Math.max(px[i], px[i + 1], px[i + 2]);
    if (dark) v = 255 - v;
    v = v < 150 ? Math.max(0, (v - 40) * 1.6) : 255;
    px[i] = px[i + 1] = px[i + 2] = Math.min(255, v);
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Lê o texto de uma imagem de item. */
export async function recognizeItemImage(src: Blob, onProgress?: (p: number, status: string) => void): Promise<string> {
  progressCb = onProgress ?? null;
  const canvas = await preprocess(src);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  progressCb = null;
  return data.text;
}
