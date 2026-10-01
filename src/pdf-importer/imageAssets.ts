export type DecodedImage = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; bitmap?: ImageBitmap }
export type ImageEncoder = (image: DecodedImage) => Promise<string>

export function rgbaPixels(image: DecodedImage) {
  const { width, height, data, kind } = image
  if (!data) throw new Error('Imagem sem pixels disponíveis.')
  if (kind === 3) return new Uint8ClampedArray(data)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x, target = pixel * 4
    if (kind === 2) rgba.set(data.subarray(pixel * 3, pixel * 3 + 3), target)
    else if (kind === 1) rgba.fill(data[y * Math.ceil(width / 8) + (x >> 3)] & (128 >> (x % 8)) ? 255 : 0, target, target + 3)
    else throw new Error('Formato de imagem não suportado.')
    rgba[target + 3] = 255
  }
  return rgba
}

export const encodeBrowserImage: ImageEncoder = async image => {
  if (typeof document === 'undefined') throw new Error('Conversão de imagem requer canvas.')
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível.')
  if (image.bitmap) context.drawImage(image.bitmap, 0, 0)
  else context.putImageData(new ImageData(rgbaPixels(image), image.width, image.height), 0, 0)
  return canvas.toDataURL('image/png')
}
