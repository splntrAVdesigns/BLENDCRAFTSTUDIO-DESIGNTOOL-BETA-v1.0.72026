export interface MP4SampleInput {
  data: Uint8Array;
  duration: number;
  timestamp: number;
  keyFrame: boolean;
}

export interface MP4MuxerOptions {
  width: number;
  height: number;
  timescale: number;
  avcDecoderConfig: Uint8Array;
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

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function u8(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function u16(value: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setUint16(0, value, false);
  return new Uint8Array(buf);
}

function u24(value: number): Uint8Array {
  return new Uint8Array([(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function u32(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value >>> 0, false);
  return new Uint8Array(buf);
}

function zeros(count: number): Uint8Array {
  return new Uint8Array(count);
}

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const payload = concatArrays(payloads);
  return concatArrays([u32(payload.length + 8), ascii(type), payload]);
}

function fullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  return box(type, u8(version), u24(flags), ...payloads);
}

function fixed16_16(value: number): Uint8Array {
  return u32(Math.round(value * 65536));
}

function fixed8_8(value: number): Uint8Array {
  return u16(Math.round(value * 256));
}

function makeMatrix(): Uint8Array {
  return concatArrays([
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
  ]);
}

function makeLanguageCode(code: string): Uint8Array {
  const safe = (code || 'und').padEnd(3, 'd').slice(0, 3);
  const value = ((safe.charCodeAt(0) - 0x60) << 10) |
    ((safe.charCodeAt(1) - 0x60) << 5) |
    (safe.charCodeAt(2) - 0x60);
  return u16(value);
}

function makeSampleTable(samples: MP4SampleInput[], timescale: number): {
  stts: Uint8Array;
  stss: Uint8Array;
  stsz: Uint8Array;
  stsc: Uint8Array;
  stco: (mdatOffset: number) => Uint8Array;
  totalDuration: number;
  sampleSizes: number[];
} {
  const durations = samples.map((s) => Math.max(1, Math.round(s.duration)));
  const sampleSizes = samples.map((s) => s.data.length);
  const totalDuration = durations.reduce((sum, d) => sum + d, 0);

  const sttsEntries: Array<{ count: number; delta: number }> = [];
  for (const delta of durations) {
    const prev = sttsEntries[sttsEntries.length - 1];
    if (prev && prev.delta === delta) prev.count += 1;
    else sttsEntries.push({ count: 1, delta });
  }
  const sttsPayload = concatArrays([
    u32(sttsEntries.length),
    ...sttsEntries.flatMap((entry) => [u32(entry.count), u32(entry.delta)]),
  ]);

  const keyframes = samples
    .map((sample, index) => (sample.keyFrame ? index + 1 : 0))
    .filter((n) => n > 0);
  const stssPayload = concatArrays([
    u32(keyframes.length),
    ...keyframes.map((n) => u32(n)),
  ]);

  const stszPayload = concatArrays([
    u32(0),
    u32(sampleSizes.length),
    ...sampleSizes.map((size) => u32(size)),
  ]);

  const stscPayload = concatArrays([
    u32(1),
    u32(1),
    u32(1),
    u32(1),
  ]);

  const stco = (mdatOffset: number) => {
    const offsets: Uint8Array[] = [u32(sampleSizes.length)];
    let running = mdatOffset;
    for (const size of sampleSizes) {
      offsets.push(u32(running));
      running += size;
    }
    return fullBox('stco', 0, 0, ...offsets);
  };

  return {
    stts: fullBox('stts', 0, 0, sttsPayload),
    stss: fullBox('stss', 0, 0, stssPayload),
    stsz: fullBox('stsz', 0, 0, stszPayload),
    stsc: fullBox('stsc', 0, 0, stscPayload),
    stco,
    totalDuration,
    sampleSizes,
  };
}

export class MP4Muxer {
  private readonly width: number;
  private readonly height: number;
  private readonly timescale: number;
  private readonly avcDecoderConfig: Uint8Array;
  private readonly samples: MP4SampleInput[] = [];

  constructor(options: MP4MuxerOptions) {
    this.width = options.width;
    this.height = options.height;
    this.timescale = options.timescale;
    this.avcDecoderConfig = options.avcDecoderConfig;
  }

  addSample(sample: MP4SampleInput): void {
    this.samples.push(sample);
  }

  finalize(): Uint8Array {
    const ftyp = box('ftyp', ascii('isom'), u32(0x00000200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
    const table = makeSampleTable(this.samples, this.timescale);
    const mdatPayload = concatArrays(this.samples.map((s) => s.data));
    const mdat = box('mdat', mdatPayload);

    const avc1 = box(
      'avc1',
      zeros(6),
      u16(1),
      zeros(16),
      u16(this.width),
      u16(this.height),
      fixed16_16(72),
      fixed16_16(72),
      u32(0),
      u16(1),
      concatArrays([u8(0), zeros(31)]),
      u16(0x0018),
      u16(0xffff),
      box('avcC', this.avcDecoderConfig),
    );
    const stsd = fullBox('stsd', 0, 0, u32(1), avc1);
    const dinf = box('dinf', box('dref', u8(0), u24(0), u32(1), box('url ', u8(0), u24(1))));
    const vmhd = fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0));

    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(this.timescale), u32(table.totalDuration), makeLanguageCode('und'), u16(0));
    const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('VideoHandler\0'));

    const tkhd = fullBox(
      'tkhd',
      0,
      0x0007,
      u32(0),
      u32(0),
      u32(1),
      u32(0),
      u32(table.totalDuration),
      zeros(8),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      makeMatrix(),
      fixed16_16(this.width),
      fixed16_16(this.height),
    );

    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(this.timescale),
      u32(table.totalDuration),
      fixed16_16(1),
      fixed8_8(1),
      u16(0),
      zeros(10),
      makeMatrix(),
      zeros(24),
      u32(2),
    );

    // ── STAGE-1 EXPORT FIX (critical) ─────────────────────────────────────
    // BUG: mdatDataOffset was previously computed from a tempMoov built from
    // stblPre — which does NOT contain the stco box. The final moov DOES
    // contain stco, so it is larger than tempMoov by exactly stco's byte
    // length (16 + 4·sampleCount). Every chunk offset in the file was
    // therefore shifted → players (QuickTime, Premiere, strict decoders)
    // read garbage sample data → "corrupt/unplayable MP4".
    //
    // FIX: two-pass sizing. stco's byte length is independent of the offset
    // VALUES it stores (u32 each), so build a placeholder stco with offset 0,
    // assemble the full-size moov including it, measure, then rebuild stco
    // with the true mdat data offset. Converges exactly in one pass.
    const stcoPlaceholder = table.stco(0);
    const stblSized = box('stbl', stsd, table.stts, table.stsc, table.stsz, table.stss, stcoPlaceholder);
    const minfSized = box('minf', vmhd, dinf, stblSized);
    const mdiaSized = box('mdia', mdhd, hdlr, minfSized);
    const trakSized = box('trak', tkhd, mdiaSized);
    const moovSized = box('moov', mvhd, trakSized);
    const mdatDataOffset = ftyp.length + moovSized.length + 8;
    const stco = table.stco(mdatDataOffset);
    const stbl = box('stbl', stsd, table.stts, table.stsc, table.stsz, table.stss, stco);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    const moov = box('moov', mvhd, trak);

    return concatArrays([ftyp, moov, mdat]);
  }
}