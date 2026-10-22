import sharp from 'sharp';

// Images d'événement : ré-encodées en WebP, 1 200 px de large au plus, sans métadonnées
// (conception §3.8 : pages légères, données de localisation des photos retirées).
export async function toEventImage(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
