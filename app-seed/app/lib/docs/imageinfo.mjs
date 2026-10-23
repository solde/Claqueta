// Size and type of an image from its first bytes (png, jpeg, gif, webp, svg): enough to lay out a gallery without decoding the picture.
export function imageInfo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), mime: "image/jpeg" }; i += 2 + buf.readUInt16BE(i + 2); } return { w: 0, h: 0, mime: "image/jpeg" }; }
  if (buf.subarray(0, 3).toString() === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), mime: "image/gif" };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") {
    const k = buf.subarray(12, 16).toString();
    if (k === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), mime: "image/webp" };
    if (k === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, mime: "image/webp" };
    if (k === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, mime: "image/webp" }; }
    return { w: 0, h: 0, mime: "image/webp" };
  }
  const head = buf.subarray(0, 400).toString("utf8"); if (/<svg[\s>]/i.test(head)) { const vb = /viewBox="[\d.\s-]*?\s([\d.]+)\s([\d.]+)"/.exec(head); return { w: vb ? Math.round(Number(vb[1])) : 0, h: vb ? Math.round(Number(vb[2])) : 0, mime: "image/svg+xml" }; }
  return null;
}
