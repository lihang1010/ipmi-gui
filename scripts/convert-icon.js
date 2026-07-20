const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function convertSvgToIco() {
  const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  // 读取 SVG
  const svgBuffer = fs.readFileSync(svgPath);

  // 生成不同尺寸的 PNG
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const png = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(png);
  }

  // 简单的 ICO 文件格式
  // ICO 文件头
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type: ICO
  icoHeader.writeUInt16LE(sizes.length, 4); // Number of images

  // ICO 目录
  const icoDir = Buffer.alloc(sizes.length * 16);
  let offset = 6 + sizes.length * 16;

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const png = pngBuffers[i];
    const dirOffset = i * 16;

    icoDir.writeUInt8(size === 256 ? 0 : size, dirOffset); // Width
    icoDir.writeUInt8(size === 256 ? 0 : size, dirOffset + 1); // Height
    icoDir.writeUInt8(0, dirOffset + 2); // Color palette
    icoDir.writeUInt8(0, dirOffset + 3); // Reserved
    icoDir.writeUInt16LE(1, dirOffset + 4); // Color planes
    icoDir.writeUInt16LE(32, dirOffset + 6); // Bits per pixel
    icoDir.writeUInt32LE(png.length, dirOffset + 8); // Image size
    icoDir.writeUInt32LE(offset, dirOffset + 12); // Image offset

    offset += png.length;
  }

  // 写入 ICO 文件
  const icoBuffer = Buffer.concat([icoHeader, icoDir, ...pngBuffers]);
  fs.writeFileSync(icoPath, icoBuffer);

  console.log(`ICO file created: ${icoPath}`);
  console.log(`Sizes: ${sizes.join(', ')}`);
}

convertSvgToIco().catch(console.error);
