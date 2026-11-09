import { fromBufferPromise } from "yauzl";

const MAX_THUMBNAIL_BYTES = 384 * 1024;
const THUMBNAIL_NAME = /^docProps\/thumbnail\.(png|jpe?g)$/i;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function officeThumbnail(bytes: Buffer) {
  const archive = await fromBufferPromise(bytes, { validateEntrySizes: true });
  try {
    if (archive.entryCount > 2048) return null;
    for await (const entry of archive.eachEntry()) {
      if (!THUMBNAIL_NAME.test(entry.fileName) || entry.uncompressedSize > MAX_THUMBNAIL_BYTES) continue;
      const stream = await archive.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        length += chunk.length;
        if (length > MAX_THUMBNAIL_BYTES) return null;
        chunks.push(chunk);
      }
      const image = Buffer.concat(chunks, length);
      if (image.length >= 24 && image.subarray(0, 8).equals(PNG_HEADER)) {
        const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
        if (width && height && width * height <= 4_000_000) return { image, type: "image/png" };
      }
      if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
        return { image, type: "image/jpeg" };
      }
    }
    return null;
  } finally {
    archive.close();
  }
}
