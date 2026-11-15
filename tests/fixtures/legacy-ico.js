import { encodeIco } from "@oliverj/tinyico";

// Authored pixels in a legacy layout: complete 32-bit BI_RGB DIBs, imageSize 0,
// plus 128/192 unused zero bytes in the 32/48px directory entries.
export function paddedDibIco({ sizes = [16, 32, 48] } = {}) {
  const ico = encodeIco(
    sizes.map((size) => {
      const rgba = Buffer.alloc(size * size * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba[offset] = 17;
        rgba[offset + 1] = 102;
        rgba[offset + 2] = 204;
        rgba[offset + 3] = 255;
      }
      return { rgba, width: size, height: size };
    }),
    { format: "dib" },
  );
  const directory = Buffer.from(ico.subarray(0, 6 + sizes.length * 16));
  const parts = [directory];
  let offset = directory.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    const size = ico.readUInt32LE(entry + 8);
    const start = ico.readUInt32LE(entry + 12);
    const payload = Buffer.from(ico.subarray(start, start + size));
    payload.writeUInt32LE(0, 20);
    const padding = Buffer.alloc(sizes[index] >= 32 ? sizes[index] * 4 : 0);
    directory.writeUInt32LE(size + padding.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    parts.push(payload, padding);
    offset += size + padding.length;
  }
  return Buffer.concat(parts);
}
