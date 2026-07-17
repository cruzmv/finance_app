const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const icons = ['home', 'movements', 'reports', 'more'];
const states = { green: '#087A52', gray: '#656B68' };
const sizes = [
  { px: 96, suffix: '' },
  { px: 52, suffix: '@2x' },
  { px: 78, suffix: '@3x' },
];

(async () => {
  for (const icon of icons) {
    const template = fs.readFileSync(path.join(root, 'svg', `${icon}.svg`), 'utf8');
    for (const [state, color] of Object.entries(states)) {
      fs.mkdirSync(path.join(root, 'png', state), { recursive: true });
      const svg = Buffer.from(template.replaceAll('COLOR', color));
      for (const { px, suffix } of sizes) {
        await sharp(svg)
          .resize(px, px)
          .png()
          .toFile(path.join(root, 'png', state, `${icon}${suffix}.png`));
      }
    }
  }
})();
