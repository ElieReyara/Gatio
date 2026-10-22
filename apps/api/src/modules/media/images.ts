import sharp from 'sharp';

// Images d'événement : ré-encodées en WebP, 1 200 px de large au plus, sans métadonnées
// (conception §3.8 : pages légères, données de localisation des photos retirées).
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export async function toEventImage(input: Buffer): Promise<Buffer | null> {
  try {
    // Le format réel est lu dans le fichier, pas déduit du type annoncé : seuls JPEG, PNG
    // et WebP passent par les décodeurs, et 25 millions de pixels au plus.
    const image = sharp(input, { failOn: 'error', limitInputPixels: 25_000_000 });
    const { format } = await image.metadata();
    if (!format || !ACCEPTED_FORMATS.has(format)) return null;
    return await image
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
