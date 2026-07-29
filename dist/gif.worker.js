// GIF.js Web Worker - Fully localized version
// This worker handles GIF encoding in a separate thread to prevent UI freezing
// Based on gif.js v0.2.0 - No remote dependencies

(function(window) {
  // NeuQuant Neural-Net Quantization Algorithm
  // Copyright (c) 1994 Anthony Dekker
  
  var ncycles = 100;
  var netsize = 256;
  var maxnetpos = netsize - 1;
  var netbiasshift = 4;
  var intbiasshift = 16;
  var intbias = (1 << intbiasshift);
  var gammashift = 10;
  var gamma = (1 << gammashift);
  var betashift = 10;
  var beta = (intbias >> betashift);
  var betagamma = (intbias << (gammashift - betashift));
  var initrad = (netsize >> 3);
  var radiusbiasshift = 6;
  var radiusbias = (1 << radiusbiasshift);
  var initradius = (initrad * radiusbias);
  var radiusdec = 30;
  var alphabiasshift = 10;
  var initalpha = (1 << alphabiasshift);
  var radbiasshift = 8;
  var radbias = (1 << radbiasshift);
  var alpharadbshift = (alphabiasshift + radbiasshift);
  var alpharadbias = (1 << alpharadbshift);
  var prime1 = 499;
  var prime2 = 491;
  var prime3 = 487;
  var prime4 = 503;
  var minpicturebytes = (3 * prime4);

  var NeuQuant = function() {
    var network;
    var netindex;
    var bias;
    var freq;
    var radpower;

    var init = function(pixels, samplefac) {
      var i, p;
      network = [];
      netindex = new Int32Array(256);
      bias = new Int32Array(netsize);
      freq = new Int32Array(netsize);
      radpower = new Int32Array(netsize >> 3);

      for (i = 0; i < netsize; i++) {
        p = (i << (netbiasshift + 8)) / netsize;
        network[i] = [p, p, p, 0];
        freq[i] = intbias / netsize;
        bias[i] = 0;
      }

      learn(pixels, samplefac);
      unbiasnet();
      inxbuild();
    };

    var unbiasnet = function() {
      for (var i = 0; i < netsize; i++) {
        network[i][0] >>= netbiasshift;
        network[i][1] >>= netbiasshift;
        network[i][2] >>= netbiasshift;
        network[i][3] = i;
      }
    };

    var altersingle = function(alpha, i, b, g, r) {
      network[i][0] -= (alpha * (network[i][0] - b)) / initalpha;
      network[i][1] -= (alpha * (network[i][1] - g)) / initalpha;
      network[i][2] -= (alpha * (network[i][2] - r)) / initalpha;
    };

    var alterneigh = function(radius, i, b, g, r) {
      var lo = Math.abs(i - radius);
      var hi = Math.min(i + radius, netsize);
      var j = i + 1;
      var k = i - 1;
      var m = 1;

      while ((j < hi) || (k > lo)) {
        var a = radpower[m++];

        if (j < hi) {
          network[j][0] -= (a * (network[j][0] - b)) / alpharadbias;
          network[j][1] -= (a * (network[j][1] - g)) / alpharadbias;
          network[j][2] -= (a * (network[j][2] - r)) / alpharadbias;
          j++;
        }

        if (k > lo) {
          network[k][0] -= (a * (network[k][0] - b)) / alpharadbias;
          network[k][1] -= (a * (network[k][1] - g)) / alpharadbias;
          network[k][2] -= (a * (network[k][2] - r)) / alpharadbias;
          k--;
        }
      }
    };

    var contest = function(b, g, r) {
      var bestd = ~(1 << 31);
      var bestbiasd = bestd;
      var bestpos = -1;
      var bestbiaspos = bestpos;

      for (var i = 0; i < netsize; i++) {
        var n = network[i];
        var dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);

        if (dist < bestd) {
          bestd = dist;
          bestpos = i;
        }

        var biasdist = dist - ((bias[i]) >> (intbiasshift - netbiasshift));

        if (biasdist < bestbiasd) {
          bestbiasd = biasdist;
          bestbiaspos = i;
        }

        var betafreq = (freq[i] >> betashift);
        freq[i] -= betafreq;
        bias[i] += (betafreq << gammashift);
      }

      freq[bestpos] += beta;
      bias[bestpos] -= betagamma;

      return bestbiaspos;
    };

    var inxbuild = function() {
      var previouscol = 0;
      var startpos = 0;

      for (var i = 0; i < netsize; i++) {
        var p = network[i];
        var q = null;
        var smallpos = i;
        var smallval = p[1];

        for (var j = i + 1; j < netsize; j++) {
          q = network[j];
          if (q[1] < smallval) {
            smallpos = j;
            smallval = q[1];
          }
        }

        q = network[smallpos];

        if (i != smallpos) {
          var temp = p[0];
          p[0] = q[0];
          q[0] = temp;
          
          temp = p[1];
          p[1] = q[1];
          q[1] = temp;
          
          temp = p[2];
          p[2] = q[2];
          q[2] = temp;
          
          temp = p[3];
          p[3] = q[3];
          q[3] = temp;
        }

        if (smallval != previouscol) {
          netindex[previouscol] = (startpos + i) >> 1;

          for (var j = previouscol + 1; j < smallval; j++) {
            netindex[j] = i;
          }

          previouscol = smallval;
          startpos = i;
        }
      }

      netindex[previouscol] = (startpos + maxnetpos) >> 1;

      for (var j = previouscol + 1; j < 256; j++) {
        netindex[j] = maxnetpos;
      }
    };

    var learn = function(pixels, samplefac) {
      var lengthcount = pixels.length;
      var alphadec = 30 + ((samplefac - 1) / 3);
      var samplepixels = lengthcount / (3 * samplefac);
      var delta = ~~(samplepixels / ncycles);
      var alpha = initalpha;
      var radius = initradius;
      var rad = radius >> radiusbiasshift;

      if (rad <= 1) rad = 0;

      for (var i = 0; i < rad; i++) {
        radpower[i] = alpha * (((rad * rad - i * i) * radbias) / (rad * rad));
      }

      var step;
      if (lengthcount < minpicturebytes) {
        samplefac = 1;
        step = 3;
      } else if ((lengthcount % prime1) !== 0) {
        step = 3 * prime1;
      } else {
        if ((lengthcount % prime2) !== 0) {
          step = 3 * prime2;
        } else {
          if ((lengthcount % prime3) !== 0) {
            step = 3 * prime3;
          } else {
            step = 3 * prime4;
          }
        }
      }

      var pix = 0;

      for (var i = 0; i < samplepixels;) {
        var b = (pixels[pix] & 0xff) << netbiasshift;
        var g = (pixels[pix + 1] & 0xff) << netbiasshift;
        var r = (pixels[pix + 2] & 0xff) << netbiasshift;

        var j = contest(b, g, r);
        altersingle(alpha, j, b, g, r);

        if (rad !== 0) alterneigh(rad, j, b, g, r);

        pix += step;

        if (pix >= lengthcount) pix -= lengthcount;

        i++;

        if (delta === 0) delta = 1;

        if (i % delta === 0) {
          alpha -= alpha / alphadec;
          radius -= radius / radiusdec;
          rad = radius >> radiusbiasshift;

          if (rad <= 1) rad = 0;

          for (j = 0; j < rad; j++) {
            radpower[j] = alpha * (((rad * rad - j * j) * radbias) / (rad * rad));
          }
        }
      }
    };

    var map = function(b, g, r) {
      var i = netindex[g];
      var j = i - 1;

      while ((i < netsize) || (j >= 0)) {
        if (i < netsize) {
          var p = network[i];
          var dist = p[1] - g;

          if (dist >= 256) {
            i = netsize;
          } else {
            i++;

            if (dist < 0) dist = -dist;

            var a = p[0] - b;
            if (a < 0) a = -a;
            dist += a;

            if (dist < 256) {
              a = p[2] - r;
              if (a < 0) a = -a;
              dist += a;

              if (dist < 256) return p[3];
            }
          }
        }

        if (j >= 0) {
          p = network[j];
          dist = g - p[1];

          if (dist >= 256) {
            j = -1;
          } else {
            j--;

            if (dist < 0) dist = -dist;

            a = p[0] - b;
            if (a < 0) a = -a;
            dist += a;

            if (dist < 256) {
              a = p[2] - r;
              if (a < 0) a = -a;
              dist += a;

              if (dist < 256) return p[3];
            }
          }
        }
      }

      return 1;
    };

    this.map = map;
    this.init = init;
  };

  // GIF Encoder
  var GIFEncoder = function(width, height) {
    this.width = ~~width;
    this.height = ~~height;
    this.transparent = null;
    this.transIndex = 0;
    this.repeat = -1;
    this.delay = 0;
    this.image = null;
    this.pixels = null;
    this.indexedPixels = null;
    this.colorDepth = null;
    this.colorTab = null;
    this.usedEntry = [];
    this.palSize = 7;
    this.dispose = -1;
    this.firstFrame = true;
    this.sample = 10;
    this.out = [];
  };

  GIFEncoder.prototype.setDelay = function(ms) {
    this.delay = Math.round(ms / 10);
  };

  GIFEncoder.prototype.setFrameRate = function(fps) {
    this.delay = Math.round(100 / fps);
  };

  GIFEncoder.prototype.setDispose = function(code) {
    if (code >= 0) this.dispose = code;
  };

  GIFEncoder.prototype.setRepeat = function(iter) {
    this.repeat = iter;
  };

  GIFEncoder.prototype.setTransparent = function(c) {
    this.transparent = c;
  };

  GIFEncoder.prototype.addFrame = function(imageData) {
    this.image = imageData;
    this.getImagePixels();
    this.analyzePixels();

    if (this.firstFrame) {
      this.writeLSD();
      this.writePalette();

      if (this.repeat >= 0) {
        this.writeNetscapeExt();
      }
    }

    this.writeGraphicCtrlExt();
    this.writeImageDesc();

    if (!this.firstFrame) this.writePalette();

    this.writePixels();
    this.firstFrame = false;
  };

  GIFEncoder.prototype.finish = function() {
    this.out.push(0x3b);
    return this.out;
  };

  GIFEncoder.prototype.setQuality = function(quality) {
    if (quality < 1) quality = 1;
    this.sample = quality;
  };

  GIFEncoder.prototype.writeHeader = function() {
    this.out.push.apply(this.out, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  };

  GIFEncoder.prototype.analyzePixels = function() {
    var len = this.pixels.length;
    var nPix = len / 3;

    this.indexedPixels = new Uint8Array(nPix);

    var nq = new NeuQuant();
    nq.init(this.pixels, this.sample);

    this.colorTab = [];

    for (var i = 0; i < 256; i++) {
      var c = nq.map(i, i, i);
      this.usedEntry[i] = false;
      this.colorTab.push([i, i, i]);
    }

    var k = 0;

    for (var j = 0; j < nPix; j++) {
      var index = nq.map(
        this.pixels[k++] & 0xff,
        this.pixels[k++] & 0xff,
        this.pixels[k++] & 0xff
      );

      this.usedEntry[index] = true;
      this.indexedPixels[j] = index;
    }

    this.pixels = null;
    this.colorDepth = 8;
    this.palSize = 7;
  };

  GIFEncoder.prototype.getImagePixels = function() {
    var w = this.width;
    var h = this.height;
    this.pixels = new Uint8Array(w * h * 3);

    var data = this.image;
    var count = 0;

    for (var i = 0; i < h; i++) {
      for (var j = 0; j < w; j++) {
        var b = (i * w * 4) + j * 4;
        this.pixels[count++] = data[b];
        this.pixels[count++] = data[b + 1];
        this.pixels[count++] = data[b + 2];
      }
    }
  };

  GIFEncoder.prototype.writeGraphicCtrlExt = function() {
    this.out.push(0x21);
    this.out.push(0xf9);
    this.out.push(0x04);

    var transp, disp;

    if (this.transparent === null) {
      transp = 0;
      disp = 0;
    } else {
      transp = 1;
      disp = 2;
    }

    if (this.dispose >= 0) {
      disp = this.dispose & 7;
    }

    disp <<= 2;
    this.out.push(0 | disp | 0 | transp);
    this.writeShort(this.delay);
    this.out.push(this.transIndex);
    this.out.push(0);
  };

  GIFEncoder.prototype.writeImageDesc = function() {
    this.out.push(0x2c);
    this.writeShort(0);
    this.writeShort(0);
    this.writeShort(this.width);
    this.writeShort(this.height);

    if (this.firstFrame) {
      this.out.push(0);
    } else {
      this.out.push(0x80 | this.palSize);
    }
  };

  GIFEncoder.prototype.writeLSD = function() {
    this.writeShort(this.width);
    this.writeShort(this.height);
    this.out.push(0x80 | 0x70 | 0x00 | this.palSize);
    this.out.push(0);
    this.out.push(0);
  };

  GIFEncoder.prototype.writeNetscapeExt = function() {
    this.out.push(0x21);
    this.out.push(0xff);
    this.out.push(0x0b);
    this.out.push.apply(this.out, [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
    this.out.push(0x03);
    this.out.push(0x01);
    this.writeShort(this.repeat);
    this.out.push(0);
  };

  GIFEncoder.prototype.writePalette = function() {
    for (var i = 0; i < 256; i++) {
      var c = this.colorTab[i];
      this.out.push(c[0]);
      this.out.push(c[1]);
      this.out.push(c[2]);
    }
  };

  GIFEncoder.prototype.writeShort = function(pValue) {
    this.out.push(pValue & 0xff);
    this.out.push((pValue >> 8) & 0xff);
  };

  GIFEncoder.prototype.writePixels = function() {
    var enc = new LZWEncoder(this.width, this.height, this.indexedPixels, this.colorDepth);
    enc.encode(this.out);
  };

  GIFEncoder.prototype.stream = function() {
    return this.out;
  };

  // LZW Encoder
  var LZWEncoder = function(width, height, pixels, colorDepth) {
    this.width = width;
    this.height = height;
    this.pixAry = pixels;
    this.initCodeSize = Math.max(2, colorDepth);
  };

  LZWEncoder.prototype.encode = function(outs) {
    outs.push(this.initCodeSize);

    var remaining = this.width * this.height;
    var curPixel = 0;

    this.compress(this.initCodeSize + 1, outs);
    outs.push(0);
  };

  LZWEncoder.prototype.compress = function(initBits, outs) {
    var fcode, c, i, ent, disp, hsize_reg, hshift;

    var accum = new Uint8Array(256);
    var htab = new Int32Array(5003);
    var codetab = new Int32Array(5003);

    var cur_accum = 0;
    var cur_bits = 0;
    var masks = [0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F, 0x003F, 0x007F, 0x00FF, 0x01FF, 0x03FF, 0x07FF, 0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF];

    var g_init_bits = initBits;
    var ClearCode = 1 << (initBits - 1);
    var EOFCode = ClearCode + 1;
    var free_ent = ClearCode + 2;
    var a_count = 0;
    var maxcode = (1 << initBits) - 1;
    var n_bits = initBits;

    ent = this.pixAry[0] & 0xff;

    hshift = 0;

    for (fcode = 5003; fcode < 65536; fcode *= 2) ++hshift;

    hshift = 8 - hshift;
    var hsize_reg_2 = 5003;

    for (i = 0; i < hsize_reg_2; ++i) htab[i] = -1;

    var output = function(code) {
      cur_accum &= masks[cur_bits];

      if (cur_bits > 0) {
        cur_accum |= (code << cur_bits);
      } else {
        cur_accum = code;
      }

      cur_bits += n_bits;

      while (cur_bits >= 8) {
        accum[a_count++] = cur_accum & 0xff;

        if (a_count >= 254) {
          outs.push(a_count);

          for (i = 0; i < a_count; ++i) {
            outs.push(accum[i]);
          }

          a_count = 0;
        }

        cur_accum >>= 8;
        cur_bits -= 8;
      }

      if (free_ent > maxcode || cur_bits > 12) {
        if (cur_bits > 12) {
          maxcode = (1 << (n_bits = 13)) - 1;
        } else {
          ++n_bits;

          if (n_bits == 13) {
            maxcode = 8192;
          } else {
            maxcode = (1 << n_bits) - 1;
          }
        }
      }

      if (code == EOFCode) {
        while (cur_bits > 0) {
          accum[a_count++] = cur_accum & 0xff;

          if (a_count >= 254) {
            outs.push(a_count);

            for (i = 0; i < a_count; ++i) {
              outs.push(accum[i]);
            }

            a_count = 0;
          }

          cur_accum >>= 8;
          cur_bits -= 8;
        }

        if (a_count > 0) {
          outs.push(a_count);

          for (i = 0; i < a_count; ++i) {
            outs.push(accum[i]);
          }
        }
      }
    };

    output(ClearCode);

    var outer: for (i = 1; i < this.pixAry.length; ++i) {
      c = this.pixAry[i] & 0xff;
      fcode = (c << 12) + ent;
      var index = (c << hshift) ^ ent;

      if (htab[index] === fcode) {
        ent = codetab[index];
        continue;
      } else if (htab[index] >= 0) {
        disp = hsize_reg_2 - index;

        if (index === 0) disp = 1;

        do {
          if ((index -= disp) < 0) index += hsize_reg_2;

          if (htab[index] === fcode) {
            ent = codetab[index];
            continue outer;
          }
        } while (htab[index] >= 0);
      }

      output(ent);
      ent = c;

      if (free_ent < 4096) {
        codetab[index] = free_ent++;
        htab[index] = fcode;
      } else {
        for (i = 0; i < hsize_reg_2; ++i) htab[i] = -1;

        free_ent = ClearCode + 2;
        output(ClearCode);
        n_bits = g_init_bits;
        maxcode = (1 << n_bits) - 1;
      }
    }

    output(ent);
    output(EOFCode);
  };

  // Worker message handler
  self.onmessage = function(ev) {
    var data = ev.data;

    if (data.width && data.height) {
      var encoder = new GIFEncoder(data.width, data.height);
      encoder.writeHeader();
      encoder.setRepeat(data.repeat === undefined ? 0 : data.repeat);
      encoder.setDelay(data.delay || 100);
      encoder.setQuality(data.quality || 10);
      encoder.setTransparent(data.transparent || null);

      for (var i = 0; i < data.frames.length; i++) {
        encoder.addFrame(data.frames[i]);
        self.postMessage({ progress: (i + 1) / data.frames.length });
      }

      encoder.finish();
      var buffer = new Uint8Array(encoder.out);
      self.postMessage({ data: buffer.buffer }, [buffer.buffer]);
    }
  };

})(self);
