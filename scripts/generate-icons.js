import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const src = path.join(root, 'public', 'icon.svg');
const outDir = path.join(root, 'public', 'icons');

async function ensureDir(dir){
  await fs.promises.mkdir(dir, { recursive: true });
}

async function generate(){
  await ensureDir(outDir);
  console.log('Generating PNG icons from', src);
  await sharp(src).resize(192,192).png().toFile(path.join(outDir, 'icon-192.png'));
  await sharp(src).resize(512,512).png().toFile(path.join(outDir, 'icon-512.png'));
  await sharp(src).resize(192,192).png().toFile(path.join(outDir, 'icon-192-maskable.png'));
  await sharp(src).resize(512,512).png().toFile(path.join(outDir, 'icon-512-maskable.png'));

  // Create favicon.ico from a 64x64 PNG
  const tmpPng = await sharp(src).resize(64,64).png().toBuffer();
  const icoBuffer = await pngToIco(tmpPng);
  await fs.promises.writeFile(path.join(root, 'public', 'favicon.ico'), icoBuffer);

  console.log('Icons written to', outDir);
  console.log('favicon.ico updated in public/');
}

generate().catch(err=>{
  console.error(err);
  process.exit(1);
});
