const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIco() {
    const svgPath = path.join(__dirname, 'favicon.svg');
    const icoPath = path.join(__dirname, 'icon.ico');

    // Sizes for ICO file (Windows tray typically uses 16, 32, 48, 256)
    const sizes = [16, 32, 48, 256];
    const pngBuffers = [];

    console.log('Generating icon from SVG...');

    for (const size of sizes) {
        const pngBuffer = await sharp(svgPath)
            .resize(size, size)
            .png()
            .toBuffer();
        pngBuffers.push({ size, data: pngBuffer });
        console.log(`  Generated ${size}x${size} PNG`);
    }

    // Build ICO file
    // ICO format: Header + Directory entries + Image data
    const numImages = pngBuffers.length;
    const headerSize = 6;
    const dirEntrySize = 16;
    const dirSize = dirEntrySize * numImages;

    // Calculate offsets for each image
    let offset = headerSize + dirSize;
    const images = pngBuffers.map(img => {
        const entry = {
            width: img.size === 256 ? 0 : img.size, // 0 means 256 in ICO format
            height: img.size === 256 ? 0 : img.size,
            data: img.data,
            offset: offset
        };
        offset += img.data.length;
        return entry;
    });

    // Total file size
    const totalSize = offset;
    const icoBuffer = Buffer.alloc(totalSize);

    // Write ICO header
    icoBuffer.writeUInt16LE(0, 0);        // Reserved, must be 0
    icoBuffer.writeUInt16LE(1, 2);        // Image type: 1 = ICO
    icoBuffer.writeUInt16LE(numImages, 4); // Number of images

    // Write directory entries
    let dirOffset = headerSize;
    for (const img of images) {
        icoBuffer.writeUInt8(img.width, dirOffset);      // Width
        icoBuffer.writeUInt8(img.height, dirOffset + 1); // Height
        icoBuffer.writeUInt8(0, dirOffset + 2);          // Color palette (0 = no palette)
        icoBuffer.writeUInt8(0, dirOffset + 3);          // Reserved
        icoBuffer.writeUInt16LE(1, dirOffset + 4);       // Color planes
        icoBuffer.writeUInt16LE(32, dirOffset + 6);      // Bits per pixel
        icoBuffer.writeUInt32LE(img.data.length, dirOffset + 8);  // Image size
        icoBuffer.writeUInt32LE(img.offset, dirOffset + 12);      // Offset
        dirOffset += dirEntrySize;
    }

    // Write image data
    for (const img of images) {
        img.data.copy(icoBuffer, img.offset);
    }

    // Write ICO file
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`\nICO file created: ${icoPath}`);
    console.log(`File size: ${totalSize} bytes`);
}

generateIco().catch(console.error);
