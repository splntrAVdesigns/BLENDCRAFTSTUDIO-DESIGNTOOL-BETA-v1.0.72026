export interface WebMChunkInput {
  data: Uint8Array;
  timestampUs: number;
  durationUs: number;
  keyFrame: boolean;
}

export interface WebMMuxerOptions {
  width: number;
  height: number;
  codecId: 'V_VP8' | 'V_VP9';
  frameRate: number;
}

function concatArrays(parts: Uint8Array[]): Uint8Array {
  // Single allocation + sequential writes — faster than chained concats
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], offset);
    offset += parts[i].length;
  }
  return out;
}

function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.slice(i);
}

function idBytes(id: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = (id >>> 24) & 0xff;
  bytes[1] = (id >>> 16) & 0xff;
  bytes[2] = (id >>> 8) & 0xff;
  bytes[3] = id & 0xff;
  return trimLeadingZeros(bytes);
}

function uintBytes(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0) return new Uint8Array([0]);
  let n = Math.floor(value);
  const arr: number[] = [];
  do {
    arr.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  return new Uint8Array(arr);
}

function float64Bytes(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

function vintSize(value: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    const maxValue = Math.pow(2, 7 * length) - 1;
    if (value <= maxValue) {
      const out = new Uint8Array(length);
      let v = value;
      for (let i = length - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - length);
      return out;
    }
  }
  throw new Error(`EBML size too large: ${value}`);
}

function vintTrackNumber(trackNumber: number): Uint8Array {
  if (trackNumber < 1 || trackNumber > 126) {
    throw new Error(`Unsupported track number: ${trackNumber}`);
  }
  return new Uint8Array([0x80 | trackNumber]);
}

function el(id: number, data: Uint8Array): Uint8Array {
  return concatArrays([idBytes(id), vintSize(data.length), data]);
}

function master(id: number, children: Uint8Array[]): Uint8Array {
  const payload = concatArrays(children);
  return el(id, payload);
}

function u(id: number, value: number): Uint8Array {
  return el(id, uintBytes(value));
}

function s(id: number, value: string): Uint8Array {
  return el(id, new TextEncoder().encode(value));
}

function f(id: number, value: number): Uint8Array {
  return el(id, float64Bytes(value));
}

function signedInt16(value: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setInt16(0, value, false);
  return new Uint8Array(buf);
}

function simpleBlock(trackNumber: number, relativeTimeMs: number, keyFrame: boolean, data: Uint8Array): Uint8Array {
  const flags = keyFrame ? 0x80 : 0x00;
  return el(0xa3, concatArrays([
    vintTrackNumber(trackNumber),
    signedInt16(relativeTimeMs),
    new Uint8Array([flags]),
    data,
  ]));
}

export class WebMMuxer {
  private readonly width: number;
  private readonly height: number;
  private readonly codecId: 'V_VP8' | 'V_VP9';
  private readonly frameRate: number;
  private readonly chunks: WebMChunkInput[] = [];

  constructor(options: WebMMuxerOptions) {
    this.width = options.width;
    this.height = options.height;
    this.codecId = options.codecId;
    this.frameRate = options.frameRate;
  }

  addChunk(chunk: WebMChunkInput): void {
    this.chunks.push(chunk);
  }

  finalize(): Uint8Array {
    const timecodeScale = 1_000_000; // 1 ms in ns
    const durationMs = this.chunks.length
      ? (this.chunks[this.chunks.length - 1].timestampUs + this.chunks[this.chunks.length - 1].durationUs) / 1000
      : 0;

    const ebmlHeader = master(0x1a45dfa3, [
      u(0x4286, 1),
      u(0x42f7, 1),
      u(0x42f2, 4),
      u(0x42f3, 8),
      s(0x4282, 'webm'),
      u(0x4287, 2),
      u(0x4285, 2),
    ]);

    const info = master(0x1549a966, [
      u(0x2ad7b1, timecodeScale),
      s(0x4d80, 'Blendcraft Studio'),
      s(0x5741, 'Blendcraft Studio'),
      f(0x4489, durationMs),
    ]);

    const defaultDurationNs = Math.round(1_000_000_000 / Math.max(1, this.frameRate));
    const video = master(0xe0, [u(0xb0, this.width), u(0xba, this.height)]);
    const trackEntry = master(0xae, [
      u(0xd7, 1),
      u(0x73c5, 1),
      u(0x83, 1),
      s(0x86, this.codecId),
      u(0x23e383, defaultDurationNs),
      video,
    ]);
    const tracks = master(0x1654ae6b, [trackEntry]);

    const clusters: Uint8Array[] = [];
    let clusterStartMs: number | null = null;
    let currentBlocks: Uint8Array[] = [];
    for (const chunk of this.chunks) {
      const chunkTimeMs = Math.round(chunk.timestampUs / 1000);
      if (clusterStartMs === null) {
        clusterStartMs = chunkTimeMs;
      }
      const relative = chunkTimeMs - clusterStartMs;
      if (relative > 30_000 && currentBlocks.length > 0) {
        clusters.push(master(0x1f43b675, [u(0xe7, clusterStartMs), ...currentBlocks]));
        clusterStartMs = chunkTimeMs;
        currentBlocks = [];
      }
      currentBlocks.push(simpleBlock(1, chunkTimeMs - clusterStartMs, chunk.keyFrame, chunk.data));
    }
    if (clusterStartMs !== null) {
      clusters.push(master(0x1f43b675, [u(0xe7, clusterStartMs), ...currentBlocks]));
    }

    const segmentPayload = concatArrays([info, tracks, ...clusters]);
    const segment = concatArrays([idBytes(0x18538067), vintSize(segmentPayload.length), segmentPayload]);
    return concatArrays([ebmlHeader, segment]);
  }
}