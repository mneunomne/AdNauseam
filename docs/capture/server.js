import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import sharp from 'sharp';

// Workaround to resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Serve static files (like the HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Proxy route to fetch images
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('Missing "url" query parameter');
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch the URL');
    }

    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type');
    let base64;
    if (contentType === 'image/webp') {
      // Convert WebP to JPG
      const jpgBuffer = await sharp(buffer).jpeg().toBuffer();
      base64 = `data:image/jpeg;base64,${jpgBuffer.toString('base64')}`;
    } else {
      // Use the original image
      base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
    }

    res.send(base64);
  } catch (error) {
    console.error('Error fetching or processing image:', error);
    res.status(500).send('Internal server error');
  }
});

// convert base64 to image/jpg 
/* 
"data:image/webp;base64,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" 
*/
app.get('/convert', async (req, res) => {
  const base64 = req.query.base64;

  if (!base64) {
    return res.status(400).send('Missing "base64" parameter');
  }

  try {
    // Decode Base64 string
    const matches = base64.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).send('Invalid Base64 format');
    }

    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // Convert WebP or PNG to JPG
    if (contentType === 'image/webp' || contentType === 'image/png') {
      const jpgBuffer = await sharp(buffer).jpeg().toBuffer();
      const convertedBase64 = `data:image/jpeg;base64,${jpgBuffer.toString('base64')}`;
      return res.send(convertedBase64);
    }

    // If not WebP or PNG, return original Base64
    return res.send(base64);
  } catch (error) {
    console.error('Error converting Base64 to image:', error);
    res.status(500).send('Internal server error');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});