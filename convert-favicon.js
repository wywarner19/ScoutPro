import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const faviconPath = 'public/favicon.ico';
const iconDir = 'public/icons';

async function convert() {
  try {
    if (!fs.existsSync(iconDir)) {
      fs.mkdirSync(iconDir, { recursive: true });
    }

    const buffer = fs.readFileSync(faviconPath);
    
    await sharp(buffer)
      .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconDir, 'icon-192.png'));
    
    await sharp(buffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconDir, 'icon-512.png'));
    
    console.log('Favicon converted to PNG icons successfully');
  } catch (err) {
    console.error('Error converting favicon:', err.message);
  }
}

convert();
