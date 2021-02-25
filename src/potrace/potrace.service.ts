import { Injectable } from '@nestjs/common';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import sharp from 'sharp';
import decode from 'heic-decode';
import svgo from 'svgo';
import potrace from 'potrace';
import quantize from 'quantize';
import NearestColor from 'nearest-color';

export enum ColorMode {
  COLOR = 'color',
  BLACK_AND_WHITE = 'black-and-white',
}

// https://stackoverflow.com/a/39077686
function hexToRgb(hex: string) {
  return hex
    .replace(
      /^#?([a-f\d])([a-f\d])([a-f\d])$/i,
      (m, r, g, b) => '#' + r + r + g + g + b + b,
    )
    .substring(1)
    .match(/.{2}/g)
    .map((x) => parseInt(x, 16));
}

// https://stackoverflow.com/a/35663683
function hexify(color: string) {
  const values = color
    .replace(/rgba?\(/, '')
    .replace(/\)/, '')
    .replace(/[\s+]/g, '')
    .split(',');
  const a = parseFloat(values[3] || '1');
  const r = Math.floor(a * parseInt(values[0]) + (1 - a) * 255);
  const g = Math.floor(a * parseInt(values[1]) + (1 - a) * 255);
  const b = Math.floor(a * parseInt(values[2]) + (1 - a) * 255);
  return (
    '#' +
    ('0' + r.toString(16)).slice(-2) +
    ('0' + g.toString(16)).slice(-2) +
    ('0' + b.toString(16)).slice(-2)
  );
}

// https://graphicdesign.stackexchange.com/a/91018
function combineOpacity(a: number, b: number) {
  return 1 - (1 - a) * (1 - b);
}

async function getPixels(input: Buffer) {
  const image = sharp(input);
  const metadata = await image.metadata();
  const raw = await image.raw().toBuffer();

  const pixels = [];
  for (let i = 0; i < raw.length; i = i + metadata.channels) {
    const pixel = [];
    for (let j = 0; j < metadata.channels; j++) {
      pixel.push(raw.readUInt8(i + j));
    }
    pixels.push(pixel);
  }
  return { pixels, ...metadata };
}

@Injectable()
export class PotraceService {
  // ensure file type is image
  validateFileType(file: Express.Multer.File) {
    if (
      [
        'image/jpg',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'image/heic',
      ].includes(file.mimetype)
    ) {
      return file;
    } else {
      throw new UnsupportedMediaTypeException();
    }
  }

  // convert all images to png
  // resize png to max width or height of 1000
  async getPng(file: Express.Multer.File) {
    let image: sharp.Sharp;
    if (file.mimetype === 'image/heic') {
      // if heic, perform a manual conversion
      const {
        width, // integer width of the image
        height, // integer height of the image
        data, // ArrayBuffer containing decoded raw image data
      } = await decode({ buffer: file.buffer });

      // ArrayBuffer to Buffer https://stackoverflow.com/a/12101012
      image = await sharp(Buffer.from(data), {
        raw: { width, height, channels: 4 },
      });
    } else {
      // else, use sharp to convert the image to png
      image = await sharp(file.buffer);
    }

    const metadata = await image.metadata();

    const largestDimension =
      metadata.width > metadata.height ? 'width' : 'height';
    const ratio = 1000 / metadata[largestDimension];
    const dimensions = {
      width: Math.round(metadata.width * ratio),
      height: Math.round(metadata.height * ratio),
    };

    return image
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(dimensions.width, dimensions.height, {
        withoutEnlargement: true,
        fit: 'cover',
      })
      .png()
      .toBuffer();
  }

  async getSvg(png: Buffer) {
    return new Promise((resolve, reject) => {
      const trace = new potrace.Potrace();
      trace.loadImage(png, function (error) {
        if (error) return reject(error);
        return resolve(this.getSVG());
      });
    });
  }

  async getPosterizedSvg(png: Buffer) {
    return new Promise((resolve, reject) => {
      potrace.posterize(
        png,
        {
          // https://www.npmjs.com/package/potrace#usage
          // number of colors
          // steps: 4,
        },
        function (err, svg) {
          if (err) return reject(err);
          resolve(svg);
        },
      );
    });
  }

  getSolidSvg(svg: string) {
    svg = svg.replaceAll(`fill="black"`, '');
    const opacityRegex = /fill-opacity="[\d\.]+"/gi;
    const numberRegex = /[\d\.]+/;
    const matches = svg.match(opacityRegex);
    const colors = Array.from(new Set(matches))
      .map((fillOpacity) => ({
        fillOpacity,
        opacity: Number(fillOpacity.match(numberRegex)[0]),
      }))
      .sort((a, b) => b.opacity - a.opacity)
      .map(({ fillOpacity, opacity }, index, array) => {
        // combine all lighter opacities into dark opacity
        const lighterColors = array.slice(index);
        const trueOpacity = lighterColors.reduce(
          (acc, cur) => combineOpacity(acc, cur.opacity),
          0,
        );
        // turn opacity into hex
        const hex = hexify(`rgba(0, 0, 0, ${trueOpacity})`);
        return {
          trueOpacity,
          fillOpacity,
          opacity,
          hex,
        };
      });
    for (const color of colors) {
      svg = svg.replaceAll(color.fillOpacity, `fill="${color.hex}"`);
    }
    return svg;
  }

  async getColorizedSvg(svg: string, original: Buffer) {
    const hexRegex = /#([a-f0-9]{3}){1,2}\b/gi;
    const matches = svg.match(hexRegex);
    const colors = Array.from(new Set(matches));

    const pixelIndexesOfNearestColors = {}; // final structure: { hex: [array of pixel indexes] }
    colors.forEach((color) => (pixelIndexesOfNearestColors[color] = []));

    const svgPixels = await getPixels(Buffer.from(svg));

    const nearestColor = NearestColor.from(colors);

    svgPixels.pixels.forEach((pixel, index) => {
      // curly braces for scope https://stackoverflow.com/a/49350263
      switch (svgPixels.channels) {
        case 3: {
          const [r, g, b] = pixel;
          const rgb = `rgb(${r}, ${g}, ${b})`;
          const hex = hexify(rgb);
          pixelIndexesOfNearestColors[nearestColor(hex)].push(index);
          break;
        }
        case 4: {
          const [r, g, b, a] = pixel;
          const rgba = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
          const hex = hexify(rgba);
          pixelIndexesOfNearestColors[nearestColor(hex)].push(index);
          break;
        }
        default:
          throw new UnsupportedMediaTypeException(
            'Unsupported number of channels',
          );
      }
    });

    const originalPixels = await getPixels(original);
    const pixelsOfNearestColors = pixelIndexesOfNearestColors; // final structure: { hex: [array of pixel indexes] }
    Object.keys(pixelsOfNearestColors).forEach((hexKey) => {
      pixelsOfNearestColors[hexKey] = pixelsOfNearestColors[hexKey].map(
        (pixelIndex) => {
          const pixel = originalPixels.pixels[pixelIndex];
          switch (originalPixels.channels) {
            case 3: {
              const [r, g, b] = pixel;
              const rgb = `rgb(${r}, ${g}, ${b})`;
              return hexify(rgb);
            }
            case 4: {
              const [r, g, b, a] = pixel;
              const rgba = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
              return hexify(rgba);
            }
            default:
              throw new Error('Unsupported number of channels');
          }
        },
      );
    });

    const colorsToReplace = pixelsOfNearestColors; // final structure: { hex: hex }
    // get palette of 5 https://github.com/lokesh/color-thief/blob/master/src/color-thief-node.js#L61
    Object.keys(pixelsOfNearestColors).forEach((hexKey) => {
      const pixelArray = colorsToReplace[hexKey].map(hexToRgb);
      const colorMap = quantize(pixelArray, 5);
      const [r, g, b] = colorMap.palette()[0];
      const rgb = `rgb(${r}, ${g}, ${b})`;
      colorsToReplace[hexKey] = hexify(rgb);
    });
    Object.entries(colorsToReplace).forEach(([oldColor, newColor]) => {
      svg = svg.replaceAll(oldColor, newColor as string);
    });

    return svg;
  }

  async getOptimizedSvg(svg: string) {
    return (await svgo.optimize(svg)).data;
  }

  async processFiles(files: Express.Multer.File[], colorMode: ColorMode) {
    return Promise.all(
      files.map((file, index) =>
        Promise.resolve(file)
          .then(this.validateFileType)
          .then(async (input) => {
            // resize original, prevent memory leak
            const png = await this.getPng(input);
            switch (colorMode) {
              case ColorMode.COLOR:
                return Promise.resolve(png)
                  .then(this.getPosterizedSvg)
                  .then(this.getSolidSvg)
                  .then(async (input) => this.getColorizedSvg(input, png));
              case ColorMode.BLACK_AND_WHITE:
                return this.getSvg(png);
            }
          })
          .then(this.getOptimizedSvg)
          .then((file) => ({
            svg: file,
            fieldName: files[index].fieldname,
            originalName: files[index].originalname,
            mimeType: files[index].mimetype,
          })),
      ),
    );
  }
}
