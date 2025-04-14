const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
app.use(cors());
require('dotenv').config();

const PORT = process.env.PORT || 5000;
let lastZipPath = null;

app.post('/screenshots', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli.' });
 

  try {
    const baseUrl = new URL(url);
    const timestamp = Date.now();
    await UrlModel.create({ url, timestamp });
    const dirPath = path.join(__dirname, 'shots', `site_${timestamp}`);
    fs.mkdirSync(dirPath, { recursive: true });

    const browser = await puppeteer.launch({
      headless: true,
      // executablePath: '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36');
    await page.setJavaScriptEnabled(true);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.screenshot({ path: path.join(dirPath, 'home.png'), fullPage: true });

    const links = await page.$$eval('a[href]', (els) =>
      els.map(e => e.href).filter(h => h.startsWith(location.origin))
    );

    const visited = new Set();

    for (let link of links.slice(0, 10)) {
      if (visited.has(link)) continue;
      visited.add(link);

      try {
        const subPage = await browser.newPage();
        await subPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36');
        await subPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const filename = link.replace(baseUrl.origin, '').replace(/[\\/:"*?<>|]+/g, '_') || 'index';
        await subPage.screenshot({ path: path.join(dirPath, `${filename}.png`), fullPage: true });
        await subPage.close();
      } catch (e) {
        console.warn(`❗ Alt sayfa alınamadı: ${link}`);
      }
    }

    await browser.close();

    const zipPath = path.join(__dirname, 'shots', `screenshots_${timestamp}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(dirPath, false);
    await archive.finalize();

 output.on('close', () => {
  res.download(zipPath, 'screenshots.zip');

  res.on('finish', () => {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      fs.unlinkSync(zipPath);
      console.log('🧹 Geçici dosyalar başarıyla silindi.');
    } catch (cleanupErr) {
      console.warn('🚨 Temizleme hatası:', cleanupErr);
    }
  });
});

  } catch (err) {
    console.error('❌ Hata:', err);
    res.status(500).json({ error: 'Screenshot alınamadı.' });
  }
});
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('✅ MongoDB bağlantısı başarılı.');
}).catch(err => {
  console.error('❌ MongoDB bağlantı hatası:', err);
});
const urlSchema = new mongoose.Schema({
  url: String,
  timestamp: Number
});

const UrlModel = mongoose.model('Url', urlSchema);

app.get('/screenshots', (req, res) => {
  if (!lastZipPath || !fs.existsSync(lastZipPath)) {
    return res.status(404).send('ZIP bulunamadı.');
  }

  res.download(lastZipPath);
});

app.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`);
});